import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

/** The portal's mark: a square monogram and the name, linking home. */
export function Wordmark() {
  const { t } = useTranslation('home');
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-display text-lg text-white"
      >
        K
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-wide text-slate-900">
          {t('common:appName')}
        </span>
        <span className="text-xs text-slate-600">{t('brand.subtitle')}</span>
      </span>
    </Link>
  );
}

/** Header of the public pages (front page, sign-in): mark, language, sign in. */
export function PublicHeader({ showSignIn = true }: { showSignIn?: boolean }) {
  const { t } = useTranslation('home');
  return (
    <header className="border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Wordmark />
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher tone="light" />
          {showSignIn && (
            <Link
              to="/login"
              className="inline-flex h-9 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { t } = useTranslation(['home', 'common']);
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t('common:footer.institution')}</p>
        <nav aria-label={t('footer.label')} className="flex gap-5">
          <a href="/verify" className="hover:text-slate-900 hover:underline">
            {t('nav.verify')}
          </a>
          <Link to="/login" className="hover:text-slate-900 hover:underline">
            {t('nav.signIn')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
