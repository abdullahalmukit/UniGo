import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Brand from '../components/Brand.jsx';
import RouteLine from '../components/RouteLine.jsx';
import Field from '../components/Field.jsx';
import GoogleSection from '../components/GoogleSection.jsx';

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
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
          <h1>Rides, food and favours from people on your campus.</h1>
          <div className="route-card">
            <RouteLine from="DSC - 2no Gate" fromNote="Pickup at 4:00 PM" to="Mirpur" toNote="1 seats left" />
          </div>
        </div>
        <p className="auth-hero-foot">Made for verified university students.</p>
      </aside>

      <main className="auth-panel">
        <div className="auth-box">
          <div className="auth-mobile-brand"><Brand /></div>
          <h2>Welcome back</h2>
          <p className="muted">Log in to book rides and requests.</p>

          {error && <div className="alert" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <Field id="email" label="Email" type="email" placeholder="you@university.edu" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field id="password" label="Password" type="password" placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn btn-primary" disabled={loading}>{loading ? 'Logging in...' : 'Log in'}</button>
          </form>

          <div className="divider"><span>or</span></div>
          <GoogleSection onToken={handleGoogle} onError={setError} />

          <p className="switch">New to UniGo? <Link to="/register">Create an account</Link></p>
        </div>
      </main>
    </div>
  );
}
