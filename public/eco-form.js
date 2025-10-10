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
    if (!host) return; // no container on page
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
            box.in
