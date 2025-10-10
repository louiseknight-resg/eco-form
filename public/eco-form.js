<!-- /public/eco-form.js -->
<script>
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
      totalSteps: 4,
      postcode: '',
      addresses: [],
      addressId: '',
      addressLabel: '',
      uprn: '',
      epc: null,
      answers: { homeowner:'', firstName:'', lastName:'', phone:'', email:'', consent:false }
    };
    const setProgress = () => {
      const pct = Math.round((state.step-1)/ (state.totalSteps-1) * 100);
      progress.firstChild.style.width = pct + '%';
    };

    // --- Step 1: postcode + address lookup ---
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
          el('button', {id:'btn-continue'}, 'Continue')
        ),
        el('p', {className:'note'}, 'We use official datasets to find your EPC.')
      );

      $('#btn-find').onclick = async () => {
        const raw = $('#eco-postcode').value.trim();
        if (!raw) return alert('Please enter a postcode');
        state.postcode = raw;
        // Address lookup (UPRN)
        $('#btn-find').disabled = true;
        try {
          const data = await j(`${apiBase}/address-lookup?postcode=${encodeURIComponent(raw)}`);
          state.addresses = data.options || [];
          if (!state.addresses.length) {
            alert('No addresses found for that postcode.');
            $('#btn-find').disabled = false; return;
          }
          const sel = $('#eco-addr');
          sel.innerHTML = '';
          state.addresses.forEach(o => sel.appendChild(el('option', {value:o.id}, o.label)));
          $('#addr-block').classList.remove('hidden');
        } catch(e) {
          alert('Address lookup failed'); 
        } finally { $('#btn-find').disabled = false; }
      };

      $('#btn-continue').onclick = () => {
        const sel = $('#eco-addr');
        const picked = state.addresses.find(o => o.id === sel.value);
        if (!picked) return alert('Please select your address');
        state.addressId = picked.id;
        state.addressLabel = picked.label;
        state.uprn = picked.uprn || '';
        viewStep2();
      };
    }

    // --- Step 2: EPC check (UPRN-first) ---
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
          if (out.found && out.band) {
            box.innerHTML = '';
            box.append(
              el('div', {}, 'We found your certificate:'),
              el('p', {}, 'EPC band: ', el('strong', {}, out.band)),
              out.certificateDate ? el('p', {className:'note'}, `Certificate date: ${out.certificateDate}`) : ''
            );
          } else {
            box.innerHTML = '';
            box.append(el('p', {className:'warn'}, 'No EPC was found for this property. We can still proceed.'));
          }
        } catch(e) {
          $('#epc-box').innerHTML = 'Lookup failed. You can still continue.';
        } finally {
          // Branching: if EPC E/F/G or no EPC → ask eligibility + contact
          viewStep3();
        }
      })();
    }

    // --- Step 3: eligibility + contact ---
    function viewStep3() {
      state.step = 3; setProgress();
      stepWrap.innerHTML = '';
      const band = state.epc?.band || null;
      const poor = !band || ['E','F','G'].includes(String(band).toUpperCase());
      const msg = poor
        ? 'Good news — your property may qualify. A few quick questions:'
        : 'Your band suggests limited eligibility. We’ll still take your details in case programmes change.';
      stepWrap.append(
        el('h2', {}, 'Eligibility & Contact'),
        el('p', {className:'helper'}, msg),
        el('label', {}, 'Are you the homeowner?'),
        el('select', {id:'q-homeowner'}, el('option',{value:''},'Please choose'), el('option',{value:'yes'},'Yes'), el('option',{value:'no'},'No')),
        el('div', {className:'row'},
          el('div', {}, el('label', {}, 'First name'), el('input',{type:'text',id:'q-first'})),
          el('div', {}, el('label', {}, 'Last name'), el('input',{type:'text',id:'q-last'}))
        ),
        el('div', {className:'row'},
          el('div', {}, el('label', {}, 'Phone'), el('input',{type:'tel',id:'q-phone',placeholder:'07…'})),
          el('div', {}, el('label', {}, 'Email'), el('input',{type:'email',id:'q-email',placeholder:'you@domain.com'}))
        ),
        el('label', {},
          el('input',{type:'checkbox',id:'q-consent'}), ' I agree to be contacted about eligibility.'
        ),
        el('button', {id:'btn-next'}, 'Review & Submit')
      );

      $('#btn-next').onclick = () => {
        state.answers = {
          homeowner: $('#q-homeowner').value,
          firstName: $('#q-first').value.trim(),
          lastName:  $('#q-last').value.trim(),
          phone:     $('#q-phone').value.trim(),
          email:     $('#q-email').value.trim(),
          consent:   $('#q-consent').checked
        };
        if (!state.answers.firstName || !state.answers.lastName) return alert('Please enter your name.');
        if (!state.answers.consent) return alert('Please tick consent to proceed.');
        viewStep4();
      };
    }

    // --- Step 4: review + submit ---
    function viewStep4() {
      state.step = 4; setProgress();
      stepWrap.innerHTML = '';
      const band = state.epc?.band || 'N/A';
      stepWrap.append(
        el('h2', {}, 'Review & Submit'),
        el('p', {}, state.addressLabel),
        el('div', {className:'epc'}, 'EPC band: ', el('strong', {}, band)),
        el('p', {className:'note'}, `Postcode: ${state.postcode}`),
        el('button', {id:'btn-submit'}, 'Submit')
      );

      $('#btn-submit').onclick = async () => {
        $('#btn-submit').disabled = true;
        try {
          const payload = {
            postcode: state.postcode,
            addressLabel: state.addressLabel,
            uprn: state.uprn || null,
            epc_found: !!state.epc?.found,
            epc_band: state.epc?.band || null,
            epc_lmk: state.epc?.lmkKey || null,
            ...state.answers
          };
          const out = await j(`${apiBase}/submit`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
          });
          stepWrap.innerHTML = '';
          stepWrap.append(
            el('h2', {}, 'Thanks!'),
            el('p', {className:'ok'}, 'We’ve received your details and will be in touch.')
          );
        } catch(e) {
          $('#btn-submit').disabled = false;
          alert('Submit failed — please try again.');
        }
      };
    }

    viewStep1();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else { mount(); }
})();
</script>
