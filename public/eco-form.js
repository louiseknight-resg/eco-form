// /public/eco-form.js
(() => {
  // ---------- tiny helpers ----------
  const $ = sel => document.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) =>
      (k in n) ? (n[k] = v) : n.setAttribute(k, v)
    );
    kids.flat().forEach(k =>
      n.appendChild(typeof k === "string" ? document.createTextNode(k) : k)
    );
    return n;
  };

  // string templating: txt("Your score {score}", {score: 65})
  const txt = (str, map) =>
    String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => map?.[k] ?? "");

  // hardened JSON fetch (timeout + http errors)
  const j = async (url, opts = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, ...opts });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      if (r.status === 204) return null;
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  };

  // fetch council data (non-blocking, returns null on error)
  const fetchCouncilData = async (postcode, apiBase) => {
    try {
      const data = await j(`${apiBase}/council-lookup?postcode=${encodeURIComponent(postcode)}`);
      return data;
    } catch (e) {
      console.warn("Council lookup failed:", e);
      return null;
    }
  };

  // ---------- app mount ----------
  async function mount() {
    const host = document.getElementById("eco-form");
    if (!host) return;

    // read config injected by /eco-config.js (window-scoped)
    const CFG = (window.ECO_FORM_CONFIG || {});

    // convenience getters (safe fallbacks)
    const H   = (k, d) => (CFG.copy?.headings?.[k] ?? d);
    const C   = (k, d) => (CFG.copy?.helper?.[k]   ?? d);
    const DM  = (k)    =>  CFG.copy?.disqualifyMessages?.[k]; // may be fn or string
    const OPT = (k, d) => (CFG.options?.[k]        ?? d);

    const apiBase     = (CFG.apiBase || host.getAttribute("data-api") || "/api");
    const QUALIFY_MAX = (CFG.thresholds?.qualifyMaxScore ?? 54);

    // container + state
    host.innerHTML = "";
    const progress = el("div", { className: "progress" }, el("span"));
    const stepWrap = el("div");
    host.append(progress, stepWrap);

    const state = {
      step: 1,
      totalSteps: 15, // Address → EPC → Eligibility → Heating → Boiler Type → Walls → Building Type → Dwelling Type → Homeowner → Solar → Listed → Reason → Measures → Contact → Commitment
      postcode: "",
      addresses: [],
      addressLabel: "",
      uprn: "",
      epc: null, // {found, band, score}
      council: null, // {found, council, ward, constituency}
      eligibilityRoute: null, // 'benefit' | 'medical' | 'income'
      property: { buildingType: "", dwellingType: "", heating: "", boilerType: "", walls: "", solar: "no", listed: "not_sure", reason: "" },
      measures: null,
      answers: { homeowner: "", firstName: "", lastName: "", phone: "", email: "", consent: false }
    };

    // Capture UTM tracking - first from URL, then from localStorage as fallback
    const url = new URL(window.location.href);
    let storedUtm = {};
    try {
      const stored = localStorage.getItem('utm_tracking');
      if (stored) storedUtm = JSON.parse(stored);
    } catch(e) {
      // localStorage not available or parsing failed
    }

    state.utm = {
      source: url.searchParams.get("utm_source") || storedUtm.utm_source || null,
      medium: url.searchParams.get("utm_medium") || storedUtm.utm_medium || null,
      campaign: url.searchParams.get("utm_campaign") || storedUtm.utm_campaign || null,
      term: url.searchParams.get("utm_term") || storedUtm.utm_term || null,
      content: url.searchParams.get("utm_content") || storedUtm.utm_content || null,

      fbclid: url.searchParams.get("fbclid") || storedUtm.fbclid || null,
      gclid: url.searchParams.get("gclid") || storedUtm.gclid || null,
      msclkid: url.searchParams.get("msclkid") || storedUtm.msclkid || null,
    };

    const setProgress = () => {
      const pct = Math.round(((state.step - 1) / (state.totalSteps - 1)) * 100);
      progress.firstChild.style.width = pct + "%";
    };

    const backButton = (goToFn) => {
      const b = el(
        "button",
        { className: "govuk-button govuk-button--secondary back-btn", type: "button" },
        "Back"
      );
      b.onclick = goToFn;
      return b;
    };

    // disqualify - redirect to disqualified page
    function showDisqualify() {
      // Redirect to disqualified page (use window.top to break out of iframe)
      window.top.location.href = "/disqualified.html";
    }

    // ---------- Step 1: Address lookup (with manual fallback) ----------
    function viewStep1() {
      state.step = 1;
      setProgress();
      stepWrap.innerHTML = "";

      stepWrap.append(
        el("h2", {}, H("checkProperty", "Check your eligbility and home energy performance certificate (EPC) here")),
        el("p", { className: "helper" }, C("postcodePrompt", "Enter your postcode and choose your address.")),
        el("label", {}, "Postcode"),
        el("input", { type: "text", id: "eco-postcode", placeholder: "e.g. CA1 2AB", value: state.postcode }),
        el("button", { id: "btn-find", className: "govuk-button" }, "Find address"),
        el(
          "div",
          { id: "addr-block", className: "hidden" },
          el("label", {}, "Select your address"),
          el("select", { id: "eco-addr" }),
          el("div", { style: "margin-top:8px;" },
            el("button", { id: "btn-continue", className: "govuk-button" }, "Continue")
          ),
          el("p", { className: "note" }, "Can’t find it? ", el("a", { href: "#", id: "enter-manually" }, "Enter manually"))
        ),
        el(
          "div",
          { id: "manual-block", className: "hidden" },
          el("p", { id: "manual-msg", className: "warn hidden" }, "We couldn’t find your address — please enter it manually."),
          el("label", {}, "Address line 1"),
          el("input", { type: "text", id: "manual-line" }),
          el("label", {}, "Postcode"),
          el("input", { type: "text", id: "manual-post", value: state.postcode }),
          el("button", { id: "btn-manual-continue", className: "govuk-button" }, "Continue")
        )
      );

      const hideManualMsg = () => $("#manual-msg")?.classList.add("hidden");
      const showManualMsg = () => $("#manual-msg")?.classList.remove("hidden");

      $("#btn-find").onclick = async () => {
        const raw = $("#eco-postcode").value.trim();
        if (!raw) return alert("Please enter a postcode");
        state.postcode = raw;

        hideManualMsg();
        $("#btn-find").disabled = true;

        try {
          const data = await j(`${apiBase}/address-lookup?postcode=${encodeURIComponent(raw)}`);
          state.addresses = data.options || [];
          const hasOptions = state.addresses.length > 0;

          $("#addr-block").classList.toggle("hidden", !hasOptions);
          $("#manual-block").classList.toggle("hidden", hasOptions);

          if (hasOptions) {
            const sel = $("#eco-addr");
            sel.innerHTML = "";
            state.addresses.forEach(o => sel.appendChild(el("option", { value: o.id }, o.label)));
            hideManualMsg();
          } else {
            $("#manual-post").value = state.postcode;
            showManualMsg();
          }
        } catch (_) {
          $("#addr-block").classList.add("hidden");
          $("#manual-block").classList.remove("hidden");
          $("#manual-post").value = state.postcode;
          showManualMsg();
        } finally {
          $("#btn-find").disabled = false;
        }
      };

      $("#btn-continue").onclick = () => {
        const sel = $("#eco-addr");
        const picked = state.addresses.find(o => o.id === sel.value);
        if (!picked) return alert("Please select your address");
        state.addressLabel = picked.label;
        state.uprn        = picked.uprn || "";

        // Fetch council data in background (non-blocking)
        fetchCouncilData(state.postcode, apiBase).then(data => {
          if (data) state.council = data;
        });

        viewStep2();
      };

      $("#enter-manually").onclick = (e) => {
        e.preventDefault();
        hideManualMsg(); // user explicitly chose manual
        $("#addr-block").classList.add("hidden");
        $("#manual-block").classList.remove("hidden");
        $("#manual-post").value = state.postcode || $("#eco-postcode").value.trim();
      };

      $("#btn-manual-continue").onclick = () => {
        const line = $("#manual-line").value.trim();
        const post = $("#manual-post").value.trim();
        if (!line || !post) return alert("Please enter address and postcode");
        state.addressLabel = `${line}, ${post}`;
        state.uprn         = "";
        state.postcode     = post;

        // Fetch council data in background (non-blocking)
        fetchCouncilData(post, apiBase).then(data => {
          if (data) state.council = data;
        });

        viewStep2();
      };
    }

    // ---------- Step 2: EPC lookup + early disqualify by score ----------
    function viewStep2() {
      state.step = 2;
      setProgress();
      stepWrap.innerHTML = "";

      stepWrap.append(
        el("h2", {}, H("epc", "Energy Performance Certificate")),
        el("div", { className: "epc", id: "epc-box" }, "Checking...")
      );

      (async () => {
        try {
          const out = await j(`${apiBase}/epc-search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              postcode: state.postcode,
              uprn: state.uprn,
              addressLabel: state.addressLabel
            })
          });

          state.epc = out || { found: false };
          const box = $("#epc-box");
          box.innerHTML = "";

          if (out.found) {
            const band  = out.band || "N/A";
            const score = (typeof out.score === "number") ? out.score : null;

            box.append(
              el("p", { className: "epc-explainer" },
                "An Energy Performance Certificate (EPC) rates your home's energy efficiency from A to G, with G being the least efficient."
              ),
              el("div", { className: "epc-rating-box" },
                el("div", { className: "epc-rating-label" }, "Your EPC Rating"),
                el("div", { className: "epc-rating-band" }, band)
              )
            );

            // Get conditional message based on rating band
            let ratingMessage = '';
            // Special handling for D55 - show conditional eligibility (no ratingMessage)
            if (band === 'D' && score === 55) {
              box.append(
                el("p", { className: "epc-advice-text" },
                  "D rated homes may be eligible under specific circumstances:"
                ),
                el("ul", { className: "hint-list" },
                  el("li", {}, "You are the owner-occupier of the property"),
                  el("li", {}, "The property is under 100 square metres"),
                  el("li", {}, "The construction type is solid wall")
                ),
                el("p", { className: "note" }, "If all of these apply to you, please continue with the application.")
              );
            } else {
              // Standard rating messages for all other bands
              if (['A', 'B', 'C', 'D'].includes(band)) {
                ratingMessage = "Unfortunately your EPC rating is too high at this time to qualify. Only ratings of E or below are currently eligible. If you believe this rating is incorrect, please email clientservices@resg.uk and we'll take a closer look to see if we can help.";
              } else if (band === 'E') {
                ratingMessage = "E rated homes currently qualify around 50% of the time since funding limitations were introduced in August 2025. It is certainly worth completing the form and speaking with our consultants who will advise you what may be available to you.";
              } else if (['F', 'G'].includes(band)) {
                ratingMessage = "Your home is rated within the lowest two energy performance bands and has a high probability of securing funding at this time, provided no improvements have been made since the certificate was issued.";
              }

              // Show advice message
              if (ratingMessage) {
                box.append(
                  el("p", { className: "epc-advice-text" }, ratingMessage)
                );
              }

              // Disqualify if score is too high (A-D56+ ratings)
              if (score != null && score > QUALIFY_MAX) {
                const m = DM("highScore");
                const message = (typeof m === "function")
                  ? m(band, score)
                  : (m || `Your EPC score is ${band}${score}, which is above the qualifying threshold.`);
                return showDisqualify(message);
              }
            }
          } else {
            box.append(
              el("p", { className: "warn" }, "No EPC found. You may still qualify."),
              el("p", { className: "note" }, "We’ll ask a few questions to check eligibility.")
            );
          }

          const cont = el("button", { id: "epc-continue", className: "govuk-button" }, "Continue");
          const back = backButton(viewStep1);
          stepWrap.append(cont, back);
          cont.onclick = () => viewStep3();

        } catch (_) {
          $("#epc-box").innerHTML = "Lookup failed. We can still proceed.";
          const cont = el("button", { id: "epc-continue", className: "govuk-button" }, "Continue");
          stepWrap.append(cont, backButton(viewStep1));
          cont.onclick = () => viewStep3();
        }
      })();
    }

    // ---------- Step 3a: Benefits ----------
    function viewStep3() {
      state.step = 3;
      setProgress();
      stepWrap.innerHTML = "";

      // benefits options are config-driven; keep "none" first if emph=true
      const benefits = OPT("benefits", [
        { value: "none", label: "NO BENEFITS", emph: true },
        { value: "uc",   label: "Universal Credit" },
        { value: "pc",   label: "Pension Credit" },
        { value: "esa",  label: "Income-related ESA" },
        { value: "jsa",  label: "Income-based JSA" },
        { value: "is",   label: "Means-tested Income Support" },
        { value: "hb",   label: "Housing Benefit" }
      ]);

      stepWrap.append(
        el("p", { className: "helper" }, "Does someone in the household receive one of the following?"),
        el(
          "div",
          {},
          ...benefits.map(opt =>
            el(
              "label",
              { style: (opt.emph ? "margin-top:8px; font-weight:700; display:block;" : "") },
              el("input", { type: "radio", name: "benefit", value: opt.value }),
              ` ${opt.label}`
            )
          )
        ),
        el("button", { id: "benefit-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep2)
      );

      $("#benefit-next").onclick = () => {
        const sel = document.querySelector('input[name="benefit"]:checked');
        if (!sel) return alert("Please choose an option");
        if (sel.value !== "none") {
          state.eligibilityRoute = "benefit";
          state.benefitType = sel.value; // Store the specific benefit (uc, pc, esa, etc.)
          return viewStep4();
        }
        viewStep3b();
      };
    }

    // ---------- Step 3b: Medical ----------
    function viewStep3b() {
      state.step = 3;
      setProgress();
      stepWrap.innerHTML = "";

      const medList = CFG.copy?.medicalList ?? [
        "Respiratory (e.g. asthma, COPD)",
        "Cardiovascular (e.g. heart disease, hypertension, high blood pressure)",
        "Limited mobility (e.g. blue badge)",
        "Immunosuppressed (e.g. cancer treatment)"
      ];

      stepWrap.append(
        el("p", { className: "helper" }, "Does someone in the household have any of these conditions?"),
        el("ul", { className: "hint-list" }, ...medList.map(item => el("li", {}, item))),
        el(
          "div",
          { className: "radio-block" },
          el("label", {}, el("input", { type: "radio", name: "med", value: "yes" }), " Yes"),
          el("label", {}, el("input", { type: "radio", name: "med", value: "no" }),  " No")
        ),
        el("button", { id: "medical-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep3)
      );

      $("#medical-next").onclick = () => {
        const sel = document.querySelector('input[name="med"]:checked');
        if (!sel) return alert("Please choose Yes or No");
        state.medical = sel.value; // Store the medical response
        if (sel.value === "yes") {
          state.eligibilityRoute = "medical";
          return viewStep4();
        }
        viewStep3c();
      };
    }

    // ---------- Step 3c: Income ----------
    function viewStep3c() {
      state.step = 3;
      setProgress();
      stepWrap.innerHTML = "";

      stepWrap.append(
        el("p", { className: "helper" }, C("incomePrompt", "Is your total annual household income below £31,000?")),
        el(
          "div",
          { className: "radio-block" },
          el("label", {}, el("input", { type: "radio", name: "inc", value: "yes" }), " Yes"),
          el("label", {}, el("input", { type: "radio", name: "inc", value: "no"  }), " No")
        ),
        el("button", { id: "income-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep3b)
      );

      $("#income-next").onclick = () => {
        const sel = document.querySelector('input[name="inc"]:checked');
        if (!sel) return alert("Please choose Yes or No");
        state.income = sel.value; // Store the income response
        if (sel.value === "yes") {
          state.eligibilityRoute = "income";
          return viewStep4();
        }
        const m = DM("noRoute") || "Based on your answers, your household does not currently meet the eligibility criteria.";
        showDisqualify(m);
      };
    }

    // ---------- Step 4: Main Heating ----------
    function viewStep4() {
      state.step = 4;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");
      const heatingOpts = OPT("heating", ["", "Oil", "LPG", "Wood-coal", "Electric", "Mains Gas", "Heat Pump", "Biomass", "Other"]);

      stepWrap.append(
        el("label", {}, "What is your main heating type?", req()),
        el("select", { id: "p-heat" }, ...heatingOpts.map(v => el("option", { value: v }, v || "Choose…"))),
        el("button", { id: "heating-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep3)
      );

      $("#heating-next").onclick = () => {
        const heating = $("#p-heat").value;
        if (!heating) return alert("Please choose your main heating.");
        if (!state.property) state.property = {};
        state.property.heating = heating;
        viewStep4a();
      };
    }

    // ---------- Step 4a: Boiler Type ----------
    function viewStep4a() {
      state.step = 4.5;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      stepWrap.append(
        el("label", {}, "What type of boiler do you have?", req()),
        el("p", { className: "note" }, "If your boiler was installed before 2007, it is likely a non-condensing boiler."),
        el(
          "select",
          { id: "p-boiler" },
          el("option", { value: "" }, "Choose…"),
          el("option", { value: "condensing" }, "Condensing"),
          el("option", { value: "non-condensing" }, "Non-condensing"),
          el("option", { value: "dont-know" }, "Don't know")
        ),
        el("button", { id: "boiler-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep4)
      );

      $("#boiler-next").onclick = () => {
        const boilerType = $("#p-boiler").value;
        if (!boilerType) return alert("Please choose your boiler type.");
        state.property.boilerType = boilerType;
        viewStep5();
      };
    }

    // ---------- Step 5: Wall Type ----------
    function viewStep5() {
      state.step = 5;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");
      const wallOpts = OPT("walls", ["", "Cavity", "Solid", "Mixed Walls", "Other"]);

      stepWrap.append(
        el("label", {}, "What type of walls does your property have?", req()),
        el("select", { id: "p-walls" }, ...wallOpts.map(v => el("option", { value: v }, v || "Choose…"))),
        el("button", { id: "walls-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep4a)
      );

      $("#walls-next").onclick = () => {
        const walls = $("#p-walls").value;
        if (!walls) return alert("Please choose your wall type.");
        state.property.walls = walls;
        viewStep5a();
      };
    }

    // ---------- Step 5a: Building Type ----------
    function viewStep5a() {
      state.step = 5.5;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");
      const buildingOpts = OPT("buildingType", ["", "Detached", "Semi-detached", "Mid terrace", "End terrace", "Other"]);

      stepWrap.append(
        el("label", {}, "What type of property is it?", req()),
        el("select", { id: "p-building" }, ...buildingOpts.map(v => el("option", { value: v }, v || "Choose…"))),
        el("button", { id: "building-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep5)
      );

      $("#building-next").onclick = () => {
        const buildingType = $("#p-building").value;
        if (!buildingType) return alert("Please choose your property type.");
        state.property.buildingType = buildingType;
        viewStep5b();
      };
    }

    // ---------- Step 5b: Dwelling Type ----------
    function viewStep5b() {
      state.step = 5.75;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");
      const dwellingOpts = OPT("dwellingType", ["", "House", "Bungalow", "Flat", "Maisonette", "Park home", "Other"]);

      stepWrap.append(
        el("label", {}, "What style of dwelling is it?", req()),
        el("select", { id: "p-dwelling" }, ...dwellingOpts.map(v => el("option", { value: v }, v || "Choose…"))),
        el("button", { id: "dwelling-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep5a)
      );

      $("#dwelling-next").onclick = () => {
        const dwellingType = $("#p-dwelling").value;
        if (!dwellingType) return alert("Please choose your dwelling type.");
        state.property.dwellingType = dwellingType;
        viewStep6();
      };
    }

    // ---------- Step 6: Homeowner Status ----------
    function viewStep6() {
      state.step = 6;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      stepWrap.append(
        el("label", {}, "Are you the homeowner?", req()),
        el(
          "select",
          { id: "p-homeowner" },
          el("option", { value: "" }, "Choose…"),
          el("option", { value: "yes" }, "Yes"),
          el("option", { value: "no" }, "No")
        ),
        el("button", { id: "homeowner-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep5b)
      );

      $("#homeowner-next").onclick = () => {
        const homeowner = $("#p-homeowner").value;
        if (!homeowner) return alert("Please tell us if you are the homeowner.");
        state.property.homeowner = homeowner;
        viewStep7();
      };
    }

    // ---------- Step 7: Solar Panels ----------
    function viewStep7() {
      state.step = 7;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      stepWrap.append(
        el("label", {}, "Do you have solar panels?", req()),
        el(
          "select",
          { id: "p-solar" },
          el("option", { value: "" }, "Choose…"),
          el("option", { value: "no" }, "No"),
          el("option", { value: "yes" }, "Yes")
        ),
        el("button", { id: "solar-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep6)
      );

      $("#solar-next").onclick = () => {
        const solar = $("#p-solar").value;
        if (!solar) return alert("Please tell us if you have solar panels.");
        state.property.solar = solar;

        if (solar === "yes") {
          const m = DM("solar") || "Properties with existing solar panels are not eligible under this scheme.";
          return showDisqualify(m);
        }

        viewStep8();
      };
    }

    // ---------- Step 8: Listed Property ----------
    function viewStep8() {
      state.step = 8;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      stepWrap.append(
        el("label", {}, "Is the property listed?", req()),
        el(
          "select",
          { id: "p-listed" },
          el("option", { value: "" }, "Choose…"),
          el("option", { value: "no" }, "No"),
          el("option", { value: "yes" }, "Yes"),
          el("option", { value: "not_sure" }, "Not sure")
        ),
        el("button", { id: "listed-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep7)
      );

      $("#listed-next").onclick = () => {
        const listed = $("#p-listed").value;
        if (!listed) return alert("Please tell us if the property is listed.");
        state.property.listed = listed;
        viewStep9();
      };
    }

    // ---------- Step 9: Main Reason ----------
    function viewStep9() {
      state.step = 9;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      stepWrap.append(
        el("label", {}, "What is your main reason for reaching out?", req()),
        el("textarea", { id: "p-reason", rows: 3 }),
        el("button", { id: "reason-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep8)
      );

      $("#reason-next").onclick = () => {
        const reason = $("#p-reason").value.trim();
        if (!reason) return alert("Please tell us your main reason for reaching out.");
        state.property.reason = reason;
        viewStep10();
      };
    }

    // ---------- Step 10: Measures ----------
    function viewStep10() {
      state.step = 10;
      setProgress();
      stepWrap.innerHTML = "";

      const measures = OPT("measures", [
        { value: "air_solar",       label: "Air Source Heat Pump with Solar PV" },
        { value: "iwi_only",        label: "Internal Wall Insulation Only" },
        { value: "none",            label: "None of the above", emph: true }
      ]);

      stepWrap.append(
        el("p", { className: "helper" }, C("measuresIntro",
          "This scheme currently has two measure options available."
        )),
        el("p", { className: "helper" }, C("measuresPrompt", "Which measure are you interested in?")),
        el(
          "div",
          { className: "radio-block" },
          ...measures.map(opt =>
            el(
              "label",
              { style: opt.emph ? "font-weight:700;" : "" },
              el("input", { type: "radio", name: "measures", value: opt.value }),
              ` ${opt.label}`
            )
          )
        ),
        el("button", { id: "measures-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep9)
      );

      $("#measures-next").onclick = () => {
        const sel = document.querySelector('input[name="measures"]:checked');
        if (!sel) return alert("Please select one option");

        state.measures = sel.value;

        if (sel.value === "none") {
          const m = DM("noneMeasures") || "At this time, we can only help with Government approved measures. We may reach out if additional measures which may suit your home become available.";
          return showDisqualify(m, true);
        }

        viewStep11();
      };
    }

    // ---------- Step 11: Contact ----------
    function viewStep11() {
      state.step = 11;
      setProgress();
      stepWrap.innerHTML = "";

      const band = state.epc?.band || "N/A";

      stepWrap.append(
        el("p",  { className: "helper" }, "Please provide your details so we can confirm your eligibility."),
        el("div",{ className: "epc" }, `EPC: Band ${band}`),

        el("div", { className: "row" },
          el("div", {},
            el("label", { "data-required": "true" }, "First name"),
            el("input", { type: "text", id: "q-first" })
          ),
          el("div", {},
            el("label", { "data-required": "true" }, "Last name"),
            el("input", { type: "text", id: "q-last" })
          )
        ),

        el("div", { className: "row" },
          el("div", {},
            el("label", { "data-required": "true" }, "Mobile"),
            el("input", { type: "tel", id: "q-phone", placeholder: "07…" })
          ),
          el("div", {},
            el("label", { "data-required": "true" }, "Email"),
            el("input", { type: "email", id: "q-email", placeholder: "you@domain.com" })
          )
        ),

        el("button", { id: "contact-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep10)
      );

      $("#contact-next").onclick = () => {
        const firstName = $("#q-first").value.trim();
        const lastName  = $("#q-last").value.trim();
        const phone     = $("#q-phone").value.trim();
        const email     = $("#q-email").value.trim();

        if (!firstName) return alert("Please enter your first name.");
        if (!lastName)  return alert("Please enter your last name.");
        if (!phone)     return alert("Please enter your mobile number.");

        // Validate phone number - remove spaces and check format
        const phoneClean = phone.replace(/\s/g, "");
        // Accept: 07123456789 (11 digits), +447123456789 (with +44), or 447123456789 (with 44)
        const isValid = /^(\+44|44)?7\d{9}$/.test(phoneClean) || /^07\d{9}$/.test(phoneClean);
        if (!isValid) {
          return alert("Please enter a valid UK mobile number (e.g., 07123456789 or +447123456789).");
        }

        if (!email)     return alert("Please enter your email address.");

        state.answers = { firstName, lastName, phone, email };
        viewStep12();
      };
    }

    // ---------- Step 12: Commitment ----------
    function viewStep12() {
      state.step = 12;
      setProgress();
      stepWrap.innerHTML = "";

      stepWrap.append(
        el("div", { className: "commitment-box" },
          el(
            "label",
            { "data-required": "true" },
            el("input", { type: "checkbox", id: "q-commit" }),
            " I'm serious... I'll answer/return your call/SMS/email! ",
            "I know that a late/missed communication will prevent me from accessing the grant with Rural Energy in the future."
          ),
          ...((CFG.copy?.commitment?.notes ?? [
            "This is a free service, and our policy is to serve the most motivated and urgent enquiries.",
            "You will receive an SMS from +44 7700 156797 and an email to arrange a telephone appointment.",
            "We will only ever call you from 01228 812016. If you do not answer calls, emails, or SMS messages, you will not be able to work with us.",
            "Our team are presently oversubscribed with new inquiries."
          ]).map(n => el("p", { className: "note" }, n)))
        ),

        el("button", { id: "btn-submit", className: "govuk-button" }, "Submit"),
        backButton(viewStep11)
      );

      $("#btn-submit").onclick = async () => {
        const commit = $("#q-commit").checked;

        if (!commit) return alert("Please confirm you're serious about responding to communications.");

        // Extract first line of address (everything before the first comma)
        const addressFirstLine = state.addressLabel ? state.addressLabel.split(',')[0].trim() : null;

        const btn = $("#btn-submit");
        btn.disabled = true;

        // Fallback: If council data hasn't been fetched yet, try to fetch it now
        if (!state.council && state.postcode) {
          const councilData = await fetchCouncilData(state.postcode, apiBase);
          if (councilData) state.council = councilData;
        }

        const payload = {
          status: "qualified",
          postcode: state.postcode,
          addressLabel: state.addressLabel,
          addressFirstLine: addressFirstLine,
          uprn: state.uprn || null,
          epc_found: !!state.epc?.found,
          epc_band: state.epc?.band || null,
          epc_score: state.epc?.score || null,
          epc_certificate_url: state.epc?.certificateUrl || null,
          epc_certificate_date: state.epc?.certificateDate || null,
          epc_potential: state.epc?.potentialBand && state.epc?.potentialScore
            ? `${state.epc.potentialBand}${state.epc.potentialScore}`
            : null,
          epc_total_floor_area: state.epc?.totalFloorArea || null,
          epc_property_type: state.epc?.propertyType || null,
          buildingType: state.property?.buildingType || null,
          dwellingType: state.property?.dwellingType || null,
          eligibilityRoute: state.eligibilityRoute,
          benefitType: state.benefitType || null,
          medical: state.medical || null,
          income: state.income || null,
          property: state.property,
          measures: state.measures || null,
          homeowner: state.property?.homeowner || null,
          firstName: state.answers?.firstName,
          lastName: state.answers?.lastName,
          phone: state.answers?.phone,
          email: state.answers?.email,
          committed: true,
          utm: state.utm,
          council_found: !!state.council?.found,
          council_data: state.council || null
        };

        try {
          await j(`${apiBase}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          // After successful form submission
          if (typeof gtag === 'function') {
            gtag('event', 'form_submission', {
              'event_category': 'Lead Generation',
              'event_label': 'Contact Form'
            });
          }

          // Redirect to thank you page (use window.top to break out of iframe)
          window.top.location.href = "/thank-you.html";
        } catch (_) {
          btn.disabled = false;
          alert("Submit failed — please try again.");
        }
      };
    }

    // start
    viewStep1();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
