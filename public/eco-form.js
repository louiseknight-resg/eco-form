// /public/eco-form.js
(() => {
  const $ = sel => document.querySelector(sel);
  const el = (tag, props={}, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k,v]) => (k in n) ? n[k]=v : n.setAttribute(k,v));
    kids.flat().forEach(k => n.appendChild(typeof k==='string'?document.createTextNode(k):k));
    return n;
  };
  const j = (url, opts={}) => fetch(url, opts).then(r => r.json());

  function mount() {
    const host = document.getElementById('eco-form');
    if (!host) return;
    const apiBase = host.getAttribute('data-api') || '/api';

    host.innerHTML = '';
    const progress = el('div', {className:'progress'}, el('span'));
    const stepWrap = el('div');
    host.append(progress, stepWrap);

    const state = {
      step: 1,
      totalSteps: 5, // Address, EPC, Route, Property, Contact
      postcode: '',
      addresses: [],
      addressLabel: '',
      uprn: '',
      epc: null, // {found, band, score, ...}
      eligibilityRoute: null, // 'benefit' | 'medical' | 'income'
      property: { heating:'', walls:'', solar:'no', listed:'not_sure', reason:'' },
      answers: { homeowner:'', firstName:'', lastName:'', phone:'', email:'', consent:false }
    };
    const setProgress = () => {
      const pct = Math.round((state.step-1)/ (state.totalSteps-1) * 100);
      progress.firstChild.style.width = pct + '%';
    };

    // Helpers
    function showDisqualify(message, allowOptIn=true) {
      state.step = Math.min(state.step+1, state.totalSteps); setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Sorry, not eligible'),
        el('p', {className:'warn'}, message)
      );
      if (allowOptIn) {
        stepWrap.append(
          el('label', {}, el('input',{type:'checkbox', id:'optin'}), ' Keep me informed if eligibility rules change'),
          el('button', {id:'btn-finish'}, 'Finish')
        );
        $('#btn-finish').onclick = async () => {
          const optin = $('#optin').checked;
          if (optin) {
            // Send minimal “disqualified” record so you can keep in touch later
            try {
              await j(`${apiBase}/submit`, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  status:'disqualified_optin',
                  postcode: state.postcode,
                  addressLabel: state.addressLabel,
                  uprn: state.uprn || null,
                  epc_found: !!state.epc?.found,
                  epc_band: state.epc?.band || null,
                  epc_score: state.epc?.score || null
                })
              });
            } catch(e){}
          }
          stepWrap.innerHTML = '';
          stepWrap.append(
            el('h2', {}, 'Thanks!'),
            el('p', {className:'note'}, 'We’ll be in touch if things change.')
          );
        };
      }
    }

    // ---------------- Step 1: postcode + address lookup (manual fallback) ----------------
    function viewStep1() {
      state.step = 1; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Check your property'),
        el('p', {className:'helper'}, 'Enter your postcode and choose your address.'),
        el('label', {}, 'Postcode'),
        el('input', {type:'text', id:'eco-postcode', placeholder:'e.g. CA1 2AB', value: state.postcode}),
        el('button', {id:'btn-find'}, 'Find address'),
        el('div', {id:'addr-block', className:'hidden'},
          el('label', {}, 'Select your address'),
          el('select', {id:'eco-addr'}),
          el('div', {style:'margin-top:8px;'},
            el('button', {id:'btn-continue'}, 'Continue')
          ),
          el('p', {className:'note'}, 'Can’t find it? ', el('a',{href:'#',id:'enter-manually'},'Enter manually'))
        ),
        el('div', {id:'manual-block', className:'hidden'},
          el('label', {}, 'Address line 1'),
          el('input', {type:'text', id:'manual-line'}),
          el('label', {}, 'Postcode'),
          el('input', {type:'text', id:'manual-post', value: state.postcode}),
          el('button', {id:'btn-manual-continue'}, 'Continue')
        )
      );

      $('#btn-find').onclick = async () => {
        const raw = $('#eco-postcode').value.trim();
        if (!raw) return alert('Please enter a postcode');
        state.postcode = raw;
        $('#btn-find').disabled = true;
        try {
          const data = await j(`${apiBase}/address-lookup?postcode=${encodeURIComponent(raw)}`);
          state.addresses = data.options || [];
          const hasOptions = state.addresses.length > 0;
          $('#addr-block').classList.toggle('hidden', !hasOptions);
          $('#manual-block').classList.toggle('hidden', hasOptions);
          if (hasOptions) {
            const sel = $('#eco-addr');
            sel.innerHTML = '';
            state.addresses.forEach(o => sel.appendChild(el('option', {value:o.id}, o.label)));
          }
          if (!hasOptions) {
            $('#manual-post').value = state.postcode;
          }
        } catch(e) {
          // straight to manual if API fails
          $('#addr-block').classList.add('hidden');
          $('#manual-block').classList.remove('hidden');
        } finally { $('#btn-find').disabled = false; }
      };

      // pick from dropdown
      $('#btn-continue').onclick = () => {
        const sel = $('#eco-addr');
        const picked = state.addresses.find(o => o.id === sel.value);
        if (!picked) return alert('Please select your address');
        state.addressLabel = picked.label;
        state.uprn = picked.uprn || '';
        viewStep2();
      };

      // manual route link
      $('#enter-manually').onclick = (e) => {
        e.preventDefault();
        $('#addr-block').classList.add('hidden');
        $('#manual-block').classList.remove('hidden');
      };
      // manual continue
      $('#btn-manual-continue').onclick = () => {
        const line = $('#manual-line').value.trim();
        const post = $('#manual-post').value.trim();
        if (!line || !post) return alert('Please enter address and postcode');
        state.addressLabel = `${line}, ${post}`;
        state.uprn = ''; // none
        state.postcode = post;
        viewStep2();
      };
    }

    // ---------------- Step 2: EPC check & eligibility by EPC ----------------
    function viewStep2() {
      state.step = 2; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Energy Performance Certificate'),
        el('p', {className:'helper'}, 'We’re checking your EPC…'),
        el('div', {className:'epc', id:'epc-box'}, 'Checking…')
      );

      (async () => {
        try {
          const out = await j(`${apiBase}/epc-search`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ postcode: state.postcode, uprn: state.uprn })
          });
          state.epc = out || { found:false };
          const box = $('#epc-box');
          box.innerHTML = '';
          if (out.found) {
            const band = out.band || 'N/A';
            const score = typeof out.score === 'number' ? out.score : null;
            box.append(
              el('p', {}, 'We found your certificate:'),
              el('p', {}, 'EPC band: ', el('strong', {}, band)),
              score != null ? el('p', {className:'note'}, `EPC score: ${score}`) : ''
            );
            // Disqualify rule: anything above D60 (i.e., numeric score > 60)
            if (score != null && score > 60) {
              return showDisqualify(`Your EPC score is ${score}, which is above the qualifying threshold (D60).`);
            }
          } else {
            // no EPC still qualifies to continue
            box.append(el('p', {className:'warn'}, 'No EPC found – you may still qualify.'));
          }
          // If E/F/G or no EPC → continue; If A–D with score <= 60 → continue
          viewStep3();
        } catch(e) {
          $('#epc-box').innerHTML = 'Lookup failed. We can still proceed.';
          viewStep3();
        }
      })();
    }

    // ---------------- Step 3: Routes (Benefits → Medical → Income with early-exit) ----------------
    function viewStep3() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';

      // Benefits first (early exit on YES)
      stepWrap.append(
        el('h2', {}, 'Eligibility – Benefits'),
        el('p', {className:'helper'}, 'Does someone in the household receive one of the following?'),
        el('div', {},
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'uc'}),' Universal Credit'
          ),
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'pc'}),' Pension Credit'
          ),
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'esa'}),' Income-related ESA'
          ),
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'jsa'}),' Income-based JSA'
          ),
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'is'}),' Means-tested Income Support'
          ),
          el('label', {},
            el('input',{type:'radio',name:'benefit',value:'hb'}),' Housing Benefit'
          ),
          el('label', {style:'margin-top:8px; font-weight:700; display:block;'},
            el('input',{type:'radio',name:'benefit',value:'none'}),' NONE OF THE ABOVE'
          )
        ),
        el('button',{id:'benefit-next'},'Continue')
      );

      $('#benefit-next').onclick = () => {
        const sel = document.querySelector('input[name="benefit"]:checked');
        if (!sel) return alert('Please choose an option');
        if (sel.value !== 'none') {
          state.eligibilityRoute = 'benefit';
          return viewStep4(); // early exit to property
        }
        // else go to Medical
        viewStep3b();
      };
    }

    function viewStep3b() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Eligibility – Medical'),
        el('p', {className:'helper'}, 'Does someone in the household have any of these conditions? (respiratory, cardiovascular, limited mobility, immunosuppressed)'),
        el('div', {},
          el('label', {}, el('input',{type:'radio',name:'med',value:'yes'}),' Yes'),
          el('label', {style:'margin-left:12px;'}, el('input',{type:'radio',name:'med',value:'no'}),' No')
        ),
        el('button',{id:'medical-next'},'Continue')
      );
      $('#medical-next').onclick = () => {
        const sel = document.querySelector('input[name="med"]:checked');
        if (!sel) return alert('Please choose Yes or No');
        if (sel.value === 'yes') {
          state.eligibilityRoute = 'medical';
          return viewStep4(); // early exit to property
        }
        viewStep3c(); // income
      };
    }

    function viewStep3c() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Eligibility – Income'),
        el('p', {className:'helper'}, 'Is your total annual household income below £31,000?'),
        el('div', {},
          el('label', {}, el('input',{type:'radio',name:'inc',value:'yes'}),' Yes'),
          el('label', {style:'margin-left:12px;'}, el('input',{type:'radio',name:'inc',value:'no'}),' No')
        ),
        el('button',{id:'income-next'},'Continue')
      );
      $('#income-next').onclick = () => {
        const sel = document.querySelector('input[name="inc"]:checked');
        if (!sel) return alert('Please choose Yes or No');
        if (sel.value === 'yes') {
          state.eligibilityRoute = 'income';
          return viewStep4();
        }
        // No to all three → disqualify
        showDisqualify('Based on your answers, your household does not currently meet the eligibility criteria.');
      };
    }

    // ---------------- Step 4: Property questions (disqualify if solar = yes) ----------------
    function viewStep4() {
      state.step = 4; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Your Property'),
        el('label', {}, 'Main heating'),
        el('select', {id:'p-heat'},
          ...['','oil','LPG','wood-coal','electric','heat pump','other'].map(v => el('option',{value:v}, v || 'Choose…'))
        ),
        el('label', {}, 'Wall type'),
        el('select', {id:'p-walls'},
          ...['','cavity','solid','both'].map(v => el('option',{value:v}, v || 'Choose…'))
        ),
        el('label', {}, 'Do you have solar panels?'),
        el('select', {id:'p-solar'},
          el('option',{value:''}, 'Choose…'),
          el('option',{value:'no'}, 'No'),
          el('option',{value:'yes'}, 'Yes')
        ),
        el('label', {}, 'Is the property listed?'),
        el('select', {id:'p-listed'},
          el('option',{value:'not_sure'}, 'Not sure'),
          el('option',{value:'no'}, 'No'),
          el('option',{value:'yes'}, 'Yes')
        ),
        el('label', {}, 'Main reason for reaching out'),
        el('textarea', {id:'p-reason', rows:3, style:'width:100%; padding:10px; border:1px solid #d1d5db; border-radius:10px;'}),
        el('button', {id:'p-next'}, 'Continue')
      );

      $('#p-next').onclick = () => {
        state.property = {
          heating: $('#p-heat').value,
          walls: $('#p-walls').value,
          solar: $('#p-solar').value || 'no',
          listed: $('#p-listed').value || 'not_sure',
          reason: $('#p-reason').value.trim()
        };
        if (state.property.solar === 'yes') {
          return showDisqualify('Properties with existing solar panels are not eligible under this scheme.');
        }
        viewStep5();
      };
    }

    // ---------------- Step 5: Contact ----------------
    function viewStep5() {
      state.step = 5; setProgress();
      stepWrap.innerHTML = '';
      const band = state.epc?.band || 'N/A';
      const score = state.epc?.score != null ? state.epc.score : 'N/A';
      stepWrap.append(
        el('h2', {}, 'Contact Details'),
        el('p', {className:'helper'}, 'Please provide your details so we can confirm your eligibility.'),
        el('div', {className:'epc'}, `EPC: Band ${band} (Score: ${score})`),
        el('label', {}, 'Are you the homeowner?'),
        el('select', {id:'q-homeowner'},
          el('option',{value:''},'Please choose'),
          el('option',{value:'yes'},'Yes'),
          el('option',{value:'no'},'No')
        ),
        el('div', {className:'row'},
          el('div', {}, el('label', {}, 'First name*'), el('input',{type:'text',id:'q-first'})),
          el('div', {}, el('label', {}, 'Last name*'), el('input',{type:'text',id:'q-last'}))
        ),
        el('div', {className:'row'},
          el('div', {}, el('label', {}, 'Mobile*'), el('input',{type:'tel',id:'q-phone',placeholder:'07…'})),
          el('div', {}, el('label', {}, 'Email*'), el('input',{type:'email',id:'q-email',placeholder:'you@domain.com'}))
        ),
        el('label', {}, el('input',{type:'checkbox',id:'q-consent'}), ' I agree to be contacted about eligibility.'),
        el('button', {id:'btn-submit'}, 'Submit')
      );

      $('#btn-submit').onclick = async () => {
        const payload = {
          status: 'qualified',
          postcode: state.postcode,
          addressLabel: state.addressLabel,
          uprn: state.uprn || null,
          epc_found: !!state.epc?.found,
          epc_band: state.epc?.band || null,
          epc_score: state.epc?.score || null,
          eligibilityRoute: state.eligibilityRoute,
          property: state.property,
          homeowner: $('#q-homeowner').value,
          firstName: $('#q-first').value.trim(),
          lastName:  $('#q-last').value.trim(),
          phone:     $('#q-phone').value.trim(),
          email:     $('#q-email').value.trim(),
          consent:   $('#q-consent').checked
        };
        if (!payload.firstName || !payload.lastName) return alert('Please enter your name.');
        if (!payload.phone || !payload.email) return alert('Please enter mobile and email.');
        if (!payload.consent) return alert('Please tick consent.');

        $('#btn-submit').disabled = true;
        try {
          await j(`${apiBase}/submit`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
          });
          stepWrap.innerHTML = '';
          stepWrap.append(el('h2', {}, 'Thanks!'), el('p', {className:'ok'}, 'We’ve received your details and will be in touch.'));
        } catch(e) {
          $('#btn-submit').disabled = false;
          alert('Submit failed — please try again.');
        }
      };
    }

    // Start
    viewStep1();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
