// /public/eco-form.js
(() => {
  const $ = sel => document.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => (k in n ? (n[k] = v) : n.setAttribute(k, v)));
    kids.flat().forEach(k => n.appendChild(typeof k === "string" ? document.createTextNode(k) : k));
    return n;
  };
  const j = (url, opts = {}) => fetch(url, opts).then(r => r.json());

  function mount() {
    const host = document.getElementById("eco-form");
    if (!host) return;
    const apiBase = host.getAttribute("data-api") || "/api";

    host.innerHTML = "";
    const progress = el("div", { className: "progress" }, el("span"));
    const stepWrap = el("div");
    host.append(progress, stepWrap);

    const state = {
      step: 1,
      totalSteps: 5,
      postcode: "",
      addresses: [],
      addressLabel: "",
      uprn: "",
      epc: null, // {found, band, score}
      eligibilityRoute: null, // 'benefit' | 'medical' | 'income'
      property: { heating: "", walls: "", solar: "no", listed: "not_sure", reason: "" },
      answers: { homeowner: "", firstName: "", lastName: "", phone: "", email: "", consent: false }
    };

    const setProgress = () => {
      const pct = Math.round(((state.step - 1) / (state.totalSteps - 1)) * 100);
      progress.firstChild.style.width = pct + "%";
    };

    function backButton(goToFn) {
      const b = el("button", { className: "govuk-button govuk-button--secondary back-btn", type: "button" }, "Back");
      b.onclick = goToFn;
      return b;
    }

    function showDisqualify(message, allowOptIn = true) {
      state.step = Math.min(state.step + 1, state.totalSteps);
      setProgress();
      stepWrap.innerHTML = "";
      stepWrap.append(el("h2", {}, "Sorry, not eligible"), el("p", { className: "warn" }, message));
      if (allowOptIn) {
        const optBlock = el(
          "div",
          { className: "optin-block" },
          el("label", {}, el("input", { type: "checkbox", id: "optin" }), " Keep me informed if eligibility rules change"),
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
            const name = $("#optin-name").value.trim();
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
                  phone
                })
              });
            } catch (e) {}
          }
          stepWrap.innerHTML = "";
          stepWrap.append(el("h2", {}, "Thanks!"), el("p", { className: "note" }, "We’ll be in touch if things change."));
        };
      }
    }

// Step 1: Address lookup (with manual fallback + message)
function viewStep1() {
  state.step = 1;
  setProgress();
  stepWrap.innerHTML = "";

  stepWrap.append(
    el("h2", {}, "Check your property"),
    el("p", { className: "helper" }, "Enter your postcode and choose your address."),
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
      el("p", { className: "note" }, "Can’t find it? ",
        el("a", { href: "#", id: "enter-manually" }, "Enter manually")
      )
    ),
    el(
      "div",
      { id: "manual-block", className: "hidden" },
      // 👇 this message is shown only when lookup fails/returns no results
      el("p", { id: "manual-msg", className: "warn hidden" }, "We couldn’t find your address — please enter it manually."),
      el("label", {}, "Address line 1"),
      el("input", { type: "text", id: "manual-line" }),
      el("label", {}, "Postcode"),
      el("input", { type: "text", id: "manual-post", value: state.postcode }),
      el("button", { id: "btn-manual-continue", className: "govuk-button" }, "Continue")
    )
  );

  const hideManualMsg = () => {
    const m = document.getElementById("manual-msg");
    if (m) m.classList.add("hidden");
  };
  const showManualMsg = () => {
    const m = document.getElementById("manual-msg");
    if (m) m.classList.remove("hidden");
  };

  document.getElementById("btn-find").onclick = async () => {
    const raw = document.getElementById("eco-postcode").value.trim();
    if (!raw) return alert("Please enter a postcode");
    state.postcode = raw;

    // reset UI state before lookup
    hideManualMsg();
    document.getElementById("btn-find").disabled = true;

    try {
      const data = await j(`${apiBase}/address-lookup?postcode=${encodeURIComponent(raw)}`);
      state.addresses = data.options || [];
      const hasOptions = state.addresses.length > 0;

      // toggle blocks
      document.getElementById("addr-block").classList.toggle("hidden", !hasOptions);
      document.getElementById("manual-block").classList.toggle("hidden", hasOptions);

      if (hasOptions) {
        // fill dropdown + ensure the warning is hidden
        const sel = document.getElementById("eco-addr");
        sel.innerHTML = "";
        state.addresses.forEach(o => sel.appendChild(el("option", { value: o.id }, o.label)));
        hideManualMsg();
      } else {
        // show manual + warning message
        document.getElementById("manual-post").value = state.postcode;
        showManualMsg();
      }
    } catch (e) {
      // API error → go manual + show warning
      document.getElementById("addr-block").classList.add("hidden");
      document.getElementById("manual-block").classList.remove("hidden");
      document.getElementById("manual-post").value = state.postcode;
      showManualMsg();
    } finally {
      document.getElementById("btn-find").disabled = false;
    }
  };

  document.getElementById("btn-continue").onclick = () => {
    const sel = document.getElementById("eco-addr");
    const picked = state.addresses.find(o => o.id === sel.value);
    if (!picked) return alert("Please select your address");
    state.addressLabel = picked.label;
    state.uprn = picked.uprn || "";
    viewStep2();
  };

  document.getElementById("enter-manually").onclick = e => {
    e.preventDefault();
    // User chose manual on purpose → keep message hidden
    hideManualMsg();
    document.getElementById("addr-block").classList.add("hidden");
    document.getElementById("manual-block").classList.remove("hidden");
    document.getElementById("manual-post").value = state.postcode || document.getElementById("eco-postcode").value.trim();
  };

  document.getElementById("btn-manual-continue").onclick = () => {
    const line = document.getElementById("manual-line").value.trim();
    const post = document.getElementById("manual-post").value.trim();
    if (!line || !post) return alert("Please enter address and postcode");
    state.addressLabel = `${line}, ${post}`;
    state.uprn = "";
    state.postcode = post;
    viewStep2();
  };
}


// Step 2: EPC check & show results (band-only display)
function viewStep2() {
  state.step = 2;
  setProgress();
  stepWrap.innerHTML = "";

  stepWrap.append(
    el("h2", {}, "Energy Performance Certificate"),
    el("p", { className: "helper" }, "We’re checking your EPC…"),
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
          addressLabel: state.addressLabel   // <-- added
        })
      });
      state.epc = out || { found: false };
      const box = $("#epc-box");
      box.innerHTML = "";

      if (out.found) {
        const band = out.band || "N/A";
        const score = typeof out.score === "number" ? out.score : null;
        box.append(
          el("p", {}, "We found your certificate:"),
          el("p", {}, "EPC rating: ", el("strong", {}, band))
        );
        if (score != null && score > 60) {
          return showDisqualify(`Your EPC score is ${score}, which is above the qualifying threshold (D60).`);
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
    } catch (e) {
      $("#epc-box").innerHTML = "Lookup failed. We can still proceed.";
      const cont = el("button", { id: "epc-continue", className: "govuk-button" }, "Continue");
      stepWrap.append(cont, backButton(viewStep1));
      cont.onclick = () => viewStep3();
    }
  })();
}


    // Step 3a: Benefits (early-exit)
    function viewStep3() {
      state.step = 3;
      setProgress();
      stepWrap.innerHTML = "";

      stepWrap.append(
        el("h2", {}, "Eligibility – Benefits"),
        el("p", { className: "helper" }, "Does someone in the household receive one of the following?"),
        el(
          "div",
          {},
          el("label", { style: "margin-top:8px; font-weight:700; display:block;" }, el("input", { type: "radio", name: "benefit", value: "none" }), " NONE OF THE ABOVE"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "uc" }), " Universal Credit"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "pc" }), " Pension Credit"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "esa" }), " Income-related ESA"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "jsa" }), " Income-based JSA"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "is" }), " Means-tested Income Support"),
          el("label", {}, el("input", { type: "radio", name: "benefit", value: "hb" }), " Housing Benefit")
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

// Step 3b: Medical (early-exit)
function viewStep3b() {
  state.step = 3;
  setProgress();
  stepWrap.innerHTML = "";

stepWrap.append(
  el("h2", {}, "Eligibility – Medical"),
  el(
    "p",
    { className: "helper" },
    "Does someone in the household have any of these conditions?"
  ),
  // 👇 List the qualifying medical categories
  el(
    "ul",
    { className: "hint-list" },
    el("li", {}, "Respiratory (e.g. asthma, COPD)"),
    el("li", {}, "Cardiovascular (e.g. heart disease)"),
    el("li", {}, "Limited mobility"),
    el("li", {}, "Immunosuppressed (e.g. cancer treatment, autoimmune therapy)")
  ),
  // 👇 Radio buttons stacked vertically
  el(
    "div",
    { className: "radio-block" },
    el(
      "label",
      {},
      el("input", { type: "radio", name: "med", value: "yes" }),
      " Yes"
    ),
    el(
      "label",
      {},
      el("input", { type: "radio", name: "med", value: "no" }),
      " No"
    )
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


function viewStep3c() {
  state.step = 3;
  setProgress();
  stepWrap.innerHTML = "";

  stepWrap.append(
    el("h2", {}, "Eligibility – Income"),
    el(
      "p",
      { className: "helper" },
      "Is your total annual household income below £31,000?"
    ),
    el(
      "div",
      { className: "radio-block" },
      el(
        "label",
        {},
        el("input", { type: "radio", name: "inc", value: "yes" }),
        " Yes"
      ),
      el(
        "label",
        {},
        el("input", { type: "radio", name: "inc", value: "no" }),
        " No"
      )
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
    // No to all → disqualify
    showDisqualify(
      "Based on your answers, your household does not currently meet the eligibility criteria."
    );
  };
}


// Step 4: Property (all fields required)
function viewStep4() {
  state.step = 4;
  setProgress();
  stepWrap.innerHTML = "";

  const req = (text) => el("span", { className: "required-asterisk" }, " *");

  stepWrap.append(
    el("h2", {}, "Your Property"),

    el("label", {}, "Main heating", req()),
    el(
      "select",
      { id: "p-heat" },
      ...["", "oil", "LPG", "wood-coal", "electric", "heat pump", "other"].map(v =>
        el("option", { value: v }, v || "Choose…")
      )
    ),

    el("label", {}, "Wall type", req()),
    el(
      "select",
      { id: "p-walls" },
      ...["", "cavity", "solid", "both"].map(v =>
        el("option", { value: v }, v || "Choose…")
      )
    ),

    el("label", {}, "Do you have solar panels?", req()),
    el(
      "select",
      { id: "p-solar" },
      el("option", { value: "" }, "Choose…"),
      el("option", { value: "no" }, "No"),
      el("option", { value: "yes" }, "Yes")
    ),

    el("label", {}, "Is the property listed?", req()),
    el(
      "select",
      { id: "p-listed" },
      el("option", { value: "" }, "Choose…"),
      el("option", { value: "no" }, "No"),
      el("option", { value: "yes" }, "Yes"),
      el("option", { value: "not_sure" }, "Not sure")
    ),

    el("label", {}, "Main reason for reaching out", req()),
    el("textarea", { id: "p-reason", rows: 3 }),

    el("button", { id: "p-next", className: "govuk-button" }, "Continue"),
    backButton(viewStep3)
  );

  document.getElementById("p-next").onclick = () => {
    const heating = document.getElementById("p-heat").value;
    const walls   = document.getElementById("p-walls").value;
    const solar   = document.getElementById("p-solar").value;
    const listed  = document.getElementById("p-listed").value;
    const reason  = document.getElementById("p-reason").value.trim();

    if (!heating) return alert("Please choose your main heating.");
    if (!walls)   return alert("Please choose your wall type.");
    if (!solar)   return alert("Please tell us if you have solar panels.");
    if (!listed)  return alert("Please tell us if the property is listed.");
    if (!reason)  return alert("Please tell us your main reason for reaching out.");

    state.property = { heating, walls, solar, listed, reason };

    if (solar === "yes") {
      return showDisqualify("Properties with existing solar panels are not eligible under this scheme.");
    }

    viewStep5();
  };
}

    // Step 5: Contact
    function viewStep5() {
      state.step = 5;
      setProgress();
      stepWrap.innerHTML = "";
      const band = state.epc?.band || "N/A";
      stepWrap.append(
        el("h2", {}, "Contact Details"),
        el("p", { className: "helper" }, "Please provide your details so we can confirm your eligibility."),
        el("div", { className: "epc" }, `EPC: Band ${band}`),
        el("label", {}, "Are you the homeowner?"),
        el(
          "select",
          { id: "q-homeowner" },
          el("option", { value: "" }, "Please choose"),
          el("option", { value: "yes" }, "Yes"),
          el("option", { value: "no" }, "No")
        ),
        el(
          "div",
          { className: "row" },
          el("div", {}, el("label", {}, "First name*"), el("input", { type: "text", id: "q-first" })),
          el("div", {}, el("label", {}, "Last name*"), el("input", { type: "text", id: "q-last" }))
        ),
        el(
          "div",
          { className: "row" },
          el("div", {}, el("label", {}, "Mobile*"), el("input", { type: "tel", id: "q-phone", placeholder: "07…" })),
          el("div", {}, el("label", {}, "Email*"), el("input", { type: "email", id: "q-email", placeholder: "you@domain.com" }))
        ),
        el("label", {}, el("input", { type: "checkbox", id: "q-consent" }), " I agree to be contacted about eligibility."),
        el("button", { id: "btn-submit", className: "govuk-button" }, "Submit"),
        backButton(viewStep4)
      );

      $("#btn-submit").onclick = async () => {
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
          homeowner: $("#q-homeowner").value,
          firstName: $("#q-first").value.trim(),
          lastName: $("#q-last").value.trim(),
          phone: $("#q-phone").value.trim(),
          email: $("#q-email").value.trim(),
          consent: $("#q-consent").checked
        };
        if (!payload.firstName || !payload.lastName) return alert("Please enter your name.");
        if (!payload.phone || !payload.email) return alert("Please enter mobile and email.");
        if (!payload.consent) return alert("Please tick consent.");

        $("#btn-submit").disabled = true;
        try {
          await j(`${apiBase}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          stepWrap.innerHTML = "";
          stepWrap.append(el("h2", {}, "Thanks!"), el("p", { className: "ok" }, "We’ve received your details and will be in touch."));
        } catch (e) {
          $("#btn-submit").disabled = false;
          alert("Submit failed — please try again.");
        }
      };
    }

    // Start
    viewStep1();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
