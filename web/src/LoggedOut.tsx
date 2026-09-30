const REASONS: Record<string, string> = {
  not_allowed: 'That Hack Club account is not on the allowlist for this dashboard.',
  no_email: 'Your Hack Club account has no verified email.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Try again.',
  failed: 'Hack Club sign-in failed. Try again in a moment.',
  not_configured: 'Sign-in is not configured on this server yet.',
};

/** The whole page when there is no session: a status and one way forward. */
export function LoggedOut({ reason }: { reason: string | null }) {
  return (
    <div className="signin-wrap">
      <div className="card signin">
        <div className="signin-status">
          <span className="status-dot" aria-hidden /> Logged out
        </div>
        <h1>flockatime</h1>
        {reason && (
          <p className="signin-error" role="alert">
            {REASONS[reason] ?? 'Sign-in failed.'}
          </p>
        )}
        <a className="btn-primary" href="/auth/login">
          Sign in with Hack Club
        </a>
      </div>
    </div>
  );
}
