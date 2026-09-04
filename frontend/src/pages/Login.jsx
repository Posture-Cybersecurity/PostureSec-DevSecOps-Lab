import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { HiArrowLeft } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

// Matches MIN_PASSWORD in backend/src/routes/auth.js. Checking here too means
// the user hears about it before a round trip, not after.
const MIN_PASSWORD = 12;

function Login() {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const registering = mode === 'register';

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      toast.error('Email and password are required.');
      return;
    }
    if (registering && password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      if (registering) {
        await signUp(email.trim(), password);
        toast.success('Account created — you are signed in 🛡️');
      } else {
        const account = await signIn(email.trim(), password);
        const expiresAt = account?.expiresAt ? new Date(account.expiresAt) : null;
        toast.success(
          expiresAt
            ? `Signed in 🛡️ — your session is valid until ${expiresAt.toLocaleString()}`
            : 'Signed in 🛡️'
        );
      }
      navigate('/');
    } catch (err) {
      // Report what the server actually said where it is safe to do so. The
      // login endpoint answers the same way for an unknown account and a wrong
      // password, so this cannot be used to discover who has an account.
      const status = err.response?.status;
      const message = err.response?.data?.error;
      if (status === 409) toast.error(message || 'That email is already registered.');
      else if (status === 401) toast.error('Invalid email or password.');
      else if (status === 400) toast.error(message || 'Check your email and password.');
      else toast.error('Something went wrong. Is the API running?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-page">
      <Link to="/" className="post-detail-back">
        <HiArrowLeft size={16} /> Back to feed
      </Link>
      <h1>{registering ? 'Create an Account 🔐' : 'Sign In 🔑'}</h1>

      <form className="form-card" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            placeholder={registering ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting
              ? registering
                ? 'Creating...'
                : 'Signing in...'
              : registering
                ? 'Create Account'
                : 'Sign In'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMode(registering ? 'login' : 'register')}
          >
            {registering ? 'I already have an account' : 'Create an account'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Login;
