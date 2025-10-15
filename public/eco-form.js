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
      totalSteps: 5,
      postcode: '',
      addresses: [],
      addressLabel: '',
      uprn: '',
      epc: null,
      eligibilityRoute: null,
      property: { heating:'', walls:'', solar:'no', listed:'not_sure', reason:'' },
      answers: { homeowner:'', firstName:'', lastName:'', phone:'', email:'', consent:false }
    };

    const setProgress = () => {
      const pct = Math.round((state.step-1)/(state.totalSteps-1)*100);
      progress.firstChild.style.width = pct + '%';
    };

    function backButton(goToFn) {
      const b = el('button', {className:'govuk-button govuk-button--secondary back-btn', type:'button'}, 'Back');
      b.onclick = goToFn;
      return b;
    }

    function showDisqualify(message, allowOptIn=true) {
      state.step = Math.min(state.step+1, state.totalSteps); setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Sorry, not eligible'),
        el('p', {className:'warn'}, message)
      );
      if (allowOptIn) {
        const optBlock = el('div', {className:'optin-block'},
          el('label', {},
            el('input',{type:'checkbox', id:'optin'}),
            ' Keep me informed if eligibility rules change'
          ),
          el('div',{id:'optin-form',className:'hidden'},
            el('label', {}, 'First name'),
            el('input',{type:'text',id:'optin-name'}),
            el('label', {}, 'Email'),
            el('input',{type:'email',id:'optin-email'}),
            el('label', {}, 'Phone'),
            el('input',{type:'tel',id:'optin-phone'})
          ),
          el('button',{id:'btn-finish',className:'govuk-button'},'Finish')
        );
        stepWrap.append(optBlock);

        $('#optin').onchange = () => {
          $('#optin-form').classList.toggle('hidden', !$('#optin').checked);
        };

        $('#btn-finish').onclick = async () => {
          if ($('#optin').checked) {
            const name = $('#optin-name').value.trim();
            const email = $('#optin-email').value.trim();
            const phone = $('#optin-phone').value.trim();
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
                  epc_score: state.epc?.score || null,
                  name, email, phone
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

    // Step 1: postcode + address lookup (manual fallback)
    function viewStep1() {
      state.step = 1; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Check your property'),
        el('p', {className:'helper'}, 'Enter your postcode and choose your address.'),
        el('label', {}, 'Postcode'),
        el('input', {type:'text', id:'eco-postcode', placeholder:'e.g. CA1 2AB', value: state.postcode}),
        el('button', {id:'btn-find', className:'govuk-button'}, 'Find address'),
        el('div', {id:'addr-block', className:'hidden'},
          el('label', {}, 'Select your address'),
          el('select', {id:'eco-addr'}),
          el('div', {style:'margin-top:8px;'},
            el('button', {id:'btn-continue', className:'govuk-button'}, 'Continue')
          ),
          el('p', {className:'note'}, 'Can’t find it? ', el('a',{href:'#',id:'enter-manually'},'Enter manually'))
        ),
        el('div', {id:'manual-block', className:'hidden'},
          el('label', {}, 'Address line 1'),
          el('input', {type:'text', id:'manual-line'}),
          el('label', {}, 'Postcode'),
          el('input', {type:'text', id:'manual-post', value: state.postcode}),
          el('button', {id:'btn-manual-continue', className:'govuk-button'}, 'Continue')
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
          } else {
            $('#manual-post').value = state.postcode;
          }
        } catch(e) {
          $('#addr-block').classList.add('hidden');
          $('#manual-block').classList.remove('hidden');
        } finally { $('#btn-find').disabled = false; }
      };

      $('#btn-continue').onclick = () => {
        const sel = $('#eco-addr');
        const picked = state.addresses.find(o => o.id === sel.value);
        if (!picked) return alert('Please select your address');
        state.addressLabel = picked.label;
        state.uprn = picked.uprn || '';
        viewStep2();
      };

      $('#enter-manually').onclick = (e) => {
        e.preventDefault();
        $('#addr-block').classList.add('hidden');
        $('#manual-block').classList.remove('hidden');
      };
      $('#btn-manual-continue').onclick = () => {
        const line = $('#manual-line').value.trim();
        const post = $('#manual-post').value.trim();
        if (!line || !post) return alert('Please enter address and postcode');
        state.addressLabel = `${line}, ${post}`;
        state.uprn = '';
        state.postcode = post;
        viewStep2();
      };
    }

    // Step 2: EPC check & show results
    function viewStep2() {
      state.step = 2; setProgress();
      stepWrap.innerHTML = '';

      stepWrap.append(
        el('h2', {}, 'Energy Performance Certificate'),
        el('p', {className:'helper'}, 'We’re checking your EPC…'),
        el('div', {className:'epc', id:'epc-box'}, 'Checking...')
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
              el('p', {}, 'EPC rating: ', el('strong', {}, band))
            );
            if (score != null && score > 60) {
              return showDisqualify(
                `Your EPC score is ${score}, which is above the qualifying threshold (D60).`
              );
            }
          } else {
            box.append(
              el('p', {className:'warn'}, 'No EPC found. You may still qualify.'),
              el('p', {className:'note'}, 'We’ll ask a few questions to check eligibility.')
            );
          }

          const cont = el('button', {id:'epc-continue', className:'govuk-button'}, 'Continue');
          const back = backButton(viewStep1);
          stepWrap.append(cont, back);
          cont.onclick = () => viewStep3();

        } catch (e) {
          $('#epc-box').innerHTML = 'Lookup failed. We can still proceed.';
          const cont = el('button', {id:'epc-continue', className:'govuk-button'}, 'Continue');
          stepWrap.append(cont, backButton(viewStep1));
          cont.onclick = () => viewStep3();
        }
      })();
    }

    // Step 3: Routes (Benefits → Medical → Income with early-exit)
    function viewStep3() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';

      stepWrap.append(
        el('h2', {}, 'Eligibility – Benefits'),
        el('p', {className:'helper'}, 'Does someone in the household receive one of the following?'),
        el('div', {},
          el('label', {style:'margin-top:8px; font-weight:700; display:block;'},
            el('input',{type:'radio',name:'benefit',value:'none'}),' NONE OF THE ABOVE'
          ),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'uc'}),' Universal Credit'),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'pc'}),' Pension Credit'),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'esa'}),' Income-related ESA'),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'jsa'}),' Income-based JSA'),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'is'}),' Means-tested Income Support'),
          el('label', {}, el('input',{type:'radio',name:'benefit',value:'hb'}),' Housing Benefit')
        ),
        el('button',{id:'benefit-next',className:'govuk-button'},'Continue'),
        backButton(viewStep2)
      );

      $('#benefit-next').onclick = () => {
        const sel = document.querySelector('input[name="benefit"]:checked');
        if (!sel) return alert('Please choose an option');
        if (sel.value !== 'none') {
          state.eligibilityRoute = 'benefit';
          return viewStep4();
        }
        viewStep3b();
      };
    }

    function viewStep3b() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';
      stepWrap.append(
        el('h2', {}, 'Eligibility – Medical'),
        el('p', {className:'helper'}, 'Does someone in the household have any of these conditions?'),
        el('div', {},
          el('label', {}, el('input',{type:'radio',name:'med',value:'yes'}),' Yes'),
          el('label', {style:'margin-left:12px;'}, el('input',{type:'radio',name:'med',value:'no'}),' No')
        ),
        el('button',{id:'medical-next',className:'govuk-button'},'Continue'),
        backButton(viewStep3)
      );
      $('#medical-next').onclick = () => {
        const sel = document.querySelector('input[name="med"]:checked');
        if (!sel) return alert('Please choose Yes or No');
        if (sel.value === 'yes') {
          state.eligibilityRoute = 'medical';
          return viewStep4();
        }
        viewStep3c();
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
        el('button',{id:'income-next',className:'govuk-button'},'Continue'),
        backButton(viewStep3b)
      );
      $('#income-next').onclick = () => {
        const sel = document.querySelector('input[name="inc"]:checked');
        if (!sel) return alert('Please choose Yes or No');
        if (sel.value === 'yes') {
          state.eligibilityRoute = 'income';
          return viewStep4();
        }
        showDisqualify('Based on your answers, your household does not currently meet the eligibility criteria.');
      };
    }

    // Step 4: Property questions
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
        el('textarea', {id:'p-reason', rows:3}),
        el('button', {id:'p-next', className:'govuk-button'}, 'Continue'),
        backButton(viewStep3)
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

    // Step 5: Contact
    function viewStep5() {
      state.step = 5; setProgress();
      stepWrap.innerHTML = '';
      const band = state.epc?.band || 'N/A';
      stepWrap.append(
        el('h2', {}, 'Contact Details'),
        el('p', {className:'helper'}, 'Please provide your details so we can confirm your eligibility.'),
        el('div', {className:'epc'}, `EPC: Band ${band}`),
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
        el('button', {id:'btn-submit', className:'govuk-button'}, 'Submit
