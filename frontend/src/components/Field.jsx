import { useState } from 'react';

// A labeled input. Pass type="password" to get a show/hide button.
export default function Field({ label, id, type = 'text', ...props }) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        <input id={id} type={isPassword && visible ? 'text' : type} {...props} />
        {isPassword && (
          <button type="button" className="field-toggle" onClick={() => setVisible(!visible)}>
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  );
}
