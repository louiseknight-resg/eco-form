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
    const QUALIFY_MAX = (CFG.thresholds?.qualifyMaxScore ?? 60);

    // container + state
    host.innerHTML = "";
    const progress = el("div", { className: "progress" }, el("span"));
    const stepWrap = el("div");
    host.append(progress, stepWrap);

    const state = {
      step: 1,
      totalSteps: 6, // Address → EPC → Eligibility → Property → Measures → Contact
      postcode: "",
      addresses: [],
      addressLabel: "",
      uprn: "",
      epc: null, // {found, band, score}
      eligibilityRoute: null, // 'benefit' | 'medical' | 'income'
      property: { heating: "", walls: "", solar: "no", listed: "not_sure", reason: "" },
      measures: null,
      answers: { homeowner: "", firstName: "", lastName: "", phone: "", email: "", consent: false }
    };

    // Capture UTM tracking
    const url = new URL(window.location.href);

    state.utm = {
      source: url.searchParams.get("utm_source") || null,
      medium: url.searchParams.get("utm_medium") || null,
      campaign: url.searchParams.get("utm_campaign") || null,
      term: url.searchParams.get("utm_term") || null,
      content: url.searchParams.get("utm_content") || null,

      fbclid: url.searchParams.get("fbclid") || null,
      gclid: url.searchParams.get("gclid") || null,
      msclkid: url.searchParams.get("msclkid") || null,
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

    // EPC chart builder (government style)
    const buildEpcChart = (currentBand, currentScore, potentialBand, potentialScore) => {
      const bands = [
        { letter: 'A', range: '92+', scores: [92, 100] },
        { letter: 'B', range: '81-91', scores: [81, 91] },
        { letter: 'C', range: '69-80', scores: [69, 80] },
        { letter: 'D', range: '55-68', scores: [55, 68] },
        { letter: 'E', range: '39-54', scores: [39, 54] },
        { letter: 'F', range: '21-38', scores: [21, 38] },
        { letter: 'G', range: '1-20', scores: [1, 20] }
      ];

      return el(
        "div",
        { className: "epc-chart" },
        el("div", { className: "epc-chart-title" }, "Energy Efficiency Rating"),
        el(
          "div",
          { className: "epc-bands" },
          ...bands.map(band => {
            const bandEl = el(
              "div",
              { className: "epc-band" },
              el(
                "div",
                { className: `epc-band-bar band-${band.letter}` },
                `${band.letter}`
              ),
              el("span", { className: "epc-band-score" }, band.range)
            );

            // Add arrows for current and potential ratings
            const bar = bandEl.querySelector('.epc-band-bar');
            if (currentBand === band.letter) {
              bar.appendChild(el("div", { className: "epc-arrow current", title: `Current: ${currentScore}` }));
            }
            if (potentialBand === band.letter) {
              bar.appendChild(el("div", { className: "epc-arrow potential", title: `Potential: ${potentialScore}` }));
            }

            return bandEl;
          })
        ),
        el(
          "div",
          { className: "epc-legend" },
          el(
            "div",
            { className: "epc-legend-item" },
            el("div", { className: "epc-legend-arrow current" }),
            `Current (${currentBand} ${currentScore || ''})`
          ),
          potentialBand ? el(
            "div",
            { className: "epc-legend-item" },
            el("div", { className: "epc-legend-arrow potential" }),
            `Potential (${potentialBand} ${potentialScore || ''})`
          ) : null
        )
      );
    };

    // disqualify (with optional opt-in)
    function showDisqualify(message, allowOptIn = true) {
      state.step = Math.min(state.step + 1, state.totalSteps);
      setProgress();
      stepWrap.innerHTML = "";
      stepWrap.append(
        el("h2", {}, H("notEligible", "Sorry, not eligible")),
        el("p", { className: "warn" }, message)
      );

      if (!allowOptIn) return;

      const optBlock = el(
        "div",
        { className: "optin-block" },
        el(
          "label",
          {},
          el("input", { type: "checkbox", id: "optin" }),
          " Keep me informed if eligibility rules change"
        ),
        el(
          "div",
          { id: "optin-form", className: "hidden" },
          el("label", {}, "First name"),
          el("input", { type: "text", id: "optin-name" }),
          el("label", {}, "Email"),
          el("input", { type: "email", id: "optin-email" }),
          el("label", {}, "Phone"),
          el("input", { type: "tel", id: "optin-phone" })
        ),
        el("button", { id: "btn-finish", className: "govuk-button" }, "Finish")
      );

      stepWrap.append(optBlock);

      $("#optin").onchange = () => {
        $("#optin-form").classList.toggle("hidden", !$("#optin").checked);
      };

      $("#btn-finish").onclick = async () => {
        if ($("#optin").checked) {
          const name  = $("#optin-name").value.trim();
          const email = $("#optin-email").value.trim();
          const phone = $("#optin-phone").value.trim();
          try {
            await j(`${apiBase}/submit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                status: "disqualified_optin",
                postcode: state.postcode,
                addressLabel: state.addressLabel,
                uprn: state.uprn || null,
                epc_found: !!state.epc?.found,
                epc_band: state.epc?.band || null,
                epc_score: state.epc?.score || null,
                name,
                email,
                phone,
                utm: state.utm
              })
            });
          } catch (_) {}
        }
        window.location.href = "disqualified.html";
      };
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
        el("p", { className: "helper" }, C("epcChecking", "We’re checking your EPC…")),
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
            const potentialBand = out.potentialBand || null;
            const potentialScore = (typeof out.potentialScore === "number") ? out.potentialScore : null;

            box.append(
              el("p", {}, "We found your certificate:")
            );

            // Show EPC chart
            if (band && band !== "N/A") {
              box.append(buildEpcChart(band, score, potentialBand, potentialScore));
            } else {
              box.append(el("p", {}, "EPC rating: ", el("strong", {}, band)));
            }

            if (score != null && score > QUALIFY_MAX) {
              window.location.href = "disqualified.html";
              return;
            }
          } else {
            box.append(
              el("p", { className: "warn" }, "No EPC found. You may still qualify."),
              el("p", { className: "note" }, "We'll ask a few questions to check eligibility.")
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
        { value: "none", label: "NONE OF THE BELOW", emph: true },
        { value: "uc",   label: "Universal Credit" },
        { value: "pc",   label: "Pension Credit" },
        { value: "esa",  label: "Income-related ESA" },
        { value: "jsa",  label: "Income-based JSA" },
        { value: "is",   label: "Means-tested Income Support" },
        { value: "hb",   label: "Housing Benefit" }
      ]);

      stepWrap.append(
        el("h2", {}, H("benefits", "Eligibility – Benefits")),
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
        "Cardiovascular (e.g. heart disease, high blood pressure, hypertension)",
        "Limited mobility (e.g. blue badge)",
        "Immunosuppressed (e.g. cancer treatment)"
      ];

      stepWrap.append(
        el("h2", {}, H("medical", "Eligibility – Medical")),
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
        el("h2", {}, H("income", "Eligibility – Income")),
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
        if (sel.value === "yes") {
          state.eligibilityRoute = "income";
          return viewStep4();
        }
        window.location.href = "disqualified.html";
      };
    }

    // ---------- Step 4: Property (required fields) ----------
    function viewStep4() {
      state.step = 4;
      setProgress();
      stepWrap.innerHTML = "";

      const req = () => el("span", { className: "required-asterisk" }, " *");

      const heatingOpts = OPT("heating", ["", "Oil", "LPG", "Wood-coal", "Electric", "Electric Storage Heaters", "Heat Pump", "Biomass", "Other"]);
      const wallOpts    = OPT("walls",   ["", "Cavity", "Solid", "Mixed Walls", "Other"]);

      stepWrap.append(
        el("h2", {}, H("property", "Your Property")),

        el("label", {}, "Main heating", req()),
        el("select", { id: "p-heat" }, ...heatingOpts.map(v => el("option", { value: v }, v || "Choose…"))),

        el("label", {}, "Wall type", req()),
        el("select", { id: "p-walls" }, ...wallOpts.map(v => el("option", { value: v }, v || "Choose…"))),

        el("label", {}, "Do you have solar panels?", req()),
        el(
          "select",
          { id: "p-solar" },
          el("option", { value: ""  }, "Choose…"),
          el("option", { value: "no" }, "No"),
          el("option", { value: "yes"}, "Yes")
        ),

        el("label", {}, "Is the property listed?", req()),
        el(
          "select",
          { id: "p-listed" },
          el("option", { value: ""         }, "Choose…"),
          el("option", { value: "no"        }, "No"),
          el("option", { value: "yes"       }, "Yes"),
          el("option", { value: "not_sure"  }, "Not sure")
        ),

        el("label", {}, "Main reason for reaching out", req()),
        el("textarea", { id: "p-reason", rows: 3 }),

        el("button", { id: "p-next", className: "govuk-button" }, "Continue"),
        backButton(viewStep3)
      );

      $("#p-next").onclick = () => {
        const heating = $("#p-heat").value;
        const walls   = $("#p-walls").value;
        const solar   = $("#p-solar").value;
        const listed  = $("#p-listed").value;
        const reason  = $("#p-reason").value.trim();

        if (!heating) return alert("Please choose your main heating.");
        if (!walls)   return alert("Please choose your wall type.");
        if (!solar)   return alert("Please tell us if you have solar panels.");
        if (!listed)  return alert("Please tell us if the property is listed.");
        if (!reason)  return alert("Please tell us your main reason for reaching out.");

        state.property = { heating, walls, solar, listed, reason };

        if (solar === "yes") {
          window.location.href = "disqualified.html";
          return;
        }

        viewStep4b();
      };
    }

    // ---------- Step 4b: Measures ----------
    function viewStep4b() {
      state.step = 4;
      setProgress();
      stepWrap.innerHTML = "";

      const measures = OPT("measures", [
        { value: "air_solar",      label: "Air source heating and solar panels" },
        { value: "air_solar_wall", label: "Air source heating, solar panels and wall insulation" },
        { value: "boiler",         label: "Mains gas boiler upgrade (only available to those already connected to mains gas)" },
        { value: "none",           label: "None of the above", emph: true }
      ]);

      stepWrap.append(
        el("h2", {}, H("measures", "Measures of Interest")),
        el("p", { className: "helper" }, C("measuresIntro",
          "This scheme allows you to choose solar PV, heating and wall insulation OR solar PV and air source alone."
        )),
        el("p", { className: "helper" }, C("measuresPrompt", "Which measures are you interested in?")),
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
        backButton(viewStep4)
      );

      $("#measures-next").onclick = () => {
        const sel = document.querySelector('input[name="measures"]:checked');
        if (!sel) return alert("Please select one option");

        state.measures = sel.value;

        if (sel.value === "none") {
          window.location.href = "disqualified.html";
          return;
        }

        viewStep5();
      };
    }

    // ---------- Step 5: Contact ----------
    function viewStep5() {
      state.step = 5;
      setProgress();
      stepWrap.innerHTML = "";

      const band = state.epc?.band || "N/A";

      stepWrap.append(
        el("h2", {}, H("contact", "Contact Details")),
        el("p",  { className: "helper" }, "Please provide your details so we can confirm your eligibility."),
        el("div",{ className: "epc" }, `EPC: Band ${band}`),

        el("label", { "data-required": "true" }, "Are you the homeowner?"),
        el(
          "select",
          { id: "q-homeowner" },
          el("option", { value: ""   }, "Please choose"),
          el("option", { value: "yes"}, "Yes"),
          el("option", { value: "no" }, "No")
        ),

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
        backButton(viewStep4b)
      );

      $("#btn-submit").onclick = async () => {
        const homeowner = $("#q-homeowner").value;
        const firstName = $("#q-first").value.trim();
        const lastName  = $("#q-last").value.trim();
        const phone     = $("#q-phone").value.trim();
        const email     = $("#q-email").value.trim();
        const commit    = $("#q-commit").checked;

        if (!homeowner) return alert("Please select whether you are the homeowner.");
        if (!firstName) return alert("Please enter your first name.");
        if (!lastName)  return alert("Please enter your last name.");
        if (!phone)     return alert("Please enter your mobile number.");
        if (!email)     return alert("Please enter your email address.");
        if (!commit)    return alert("Please confirm you're serious about responding to communications.");

        const payload = {
          status: "qualified",
          postcode: state.postcode,
          addressLabel: state.addressLabel,
          uprn: state.uprn || null,
          epc_found: !!state.epc?.found,
          epc_band: state.epc?.band || null,
          epc_score: state.epc?.score || null,
          eligibilityRoute: state.eligibilityRoute,
          property: state.property,
          measures: state.measures || null,
          homeowner,
          firstName,
          lastName,
          phone,
          email,
          committed: true,
          utm: state.utm
        };

        const btn = $("#btn-submit");
        btn.disabled = true;
        try {
          await j(`${apiBase}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          window.location.href = "qualified.html";
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
