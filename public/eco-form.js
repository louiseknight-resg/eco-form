/* /public/eco-form.css */
#eco-form { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 560px; margin: 32px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 6px 20px rgba(0,0,0,.06); }
#eco-form h2 { margin: 0 0 8px; font-size: 22px; }
#eco-form p.helper { margin: 0 0 18px; color: #6b7280; }
#eco-form label { display: block; margin: 14px 0 6px; font-weight: 600; }
#eco-form input[type=text], #eco-form input[type=tel], #eco-form input[type=email], #eco-form select {
  width: 100%; padding: 12px 14px; border: 1px solid #d1d5db; border-radius: 10px; font-size: 15px;
}
#eco-form button { margin-top: 14px; display: inline-flex; align-items: center; gap: 8px; padding: 12px 16px; border: 0; border-radius: 10px; background:#111827; color:#fff; cursor:pointer; font-weight:600; }
#eco-form button[disabled] { opacity:.6; cursor:not-allowed; }
#eco-form .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
#eco-form .note { font-size: 13px; color:#6b7280; }
#eco-form .epc { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: #f3f4f6; }
#eco-form .epc strong { font-size: 18px; }
#eco-form .progress { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; margin-bottom: 16px;}
#eco-form .progress > span { display:block; height:100%; width:0%; background:linear-gradient(90deg, #22c55e, #16a34a); transition: width .35s ease; }
#eco-form .hidden { display:none !important; }
#eco-form .ok { color:#065f46; }
#eco-form .warn { color:#b45309; }
#eco-form .err { color:#b91c1c; }
