import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Brand from '../components/Brand.jsx';
import RouteLine from '../components/RouteLine.jsx';
import Field from '../components/Field.jsx';
import GoogleSection from '../components/GoogleSection.jsx';

export default function RegisterPage() {
  const { register, loginWithGoogle } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', universityName: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!form.fullName.trim() || !form.email.trim() || !form.universityName.trim() || !form.password) {
      setError('Please fill in every field.');
      return;
    }
    if (form.password.length < 8) {
      setError('Your password needs at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        universityName: form.universityName.trim(),
        password: form.password,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle(idToken) {
    setError('');
    try {
      await loginWithGoogle(idToken);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-hero">
        <Brand dark />
        <div>
          <h1>Your campus already moves. Join the ride.</h1>
          <div className="route-card">
            <RouteLine from="Your hall" fromNote="Every Sunday, 8:00 AM" to="Your campus" toNote="One seat per person" />
          </div>
        </div>
        <p className="auth-hero-foot">Made for verified university students.</p>
      </aside>

      <main className="auth-panel">
        <div className="auth-box">
          <div className="auth-mobile-brand"><Brand /></div>
          <h2>Create your account</h2>
          <p className="muted">It takes less than a minute.</p>

          {error && <div className="alert" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <Field id="fullName" label="Full name" placeholder="Md. Abdul Mukit" autoComplete="name" value={form.fullName} onChange={update('fullName')} />
            <Field id="email" label="Email" type="email" placeholder="you@university.edu" autoComplete="email" value={form.email} onChange={update('email')} />
            <Field id="universityName" label="University" placeholder="Daffodil International University" value={form.universityName} onChange={update('universityName')} />
            <Field id="password" label="Password" type="password" placeholder="At least 8 characters" autoComplete="new-password" value={form.password} onChange={update('password')} />

            <p className="hint">You can use UniGo right away. Your university is verified separately, and some features unlock after that.</p>
            <button className="btn btn-primary" disabled={loading}>{loading ? 'Creating account...' : 'Create account'}</button>
          </form>

          <div className="divider"><span>or</span></div>
          <GoogleSection onToken={handleGoogle} onError={setError} text="signup_with" />

          <p className="switch">Already have an account? <Link to="/login">Log in</Link></p>
        </div>
      </main>
    </div>
  );
}
