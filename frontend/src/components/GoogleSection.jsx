import { GoogleLogin } from '@react-oauth/google';

const hasGoogle = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

// Shows the Google button. Google gives us an ID token (credential),
// and the backend verifies it with Google.
export default function GoogleSection({ onToken, onError, text = 'continue_with' }) {
  if (!hasGoogle) {
    return <p className="hint">Google sign-in is not set up yet. Add VITE_GOOGLE_CLIENT_ID to frontend/.env.</p>;
  }

  return (
    <div className="google-wrap">
      <GoogleLogin
        onSuccess={(result) => onToken(result.credential)}
        onError={() => onError('Google sign-in failed. Please try again.')}
        text={text}
        shape="pill"
        width="360"
      />
    </div>
  );
}
