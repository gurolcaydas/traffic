import { useEffect, useState } from 'react';
import { t } from '../../core/i18n';
import { saveDesign } from '../../scenarios/storage';
import { useApp } from '../store';

/** Asks before something replaces a sandbox design that has unsaved changes. */
export function ReplaceDialog() {
  const pending = useApp((s) => s.pendingReplace);
  const scenario = useApp((s) => s.scenario);
  const { closeReplace, markSaved } = useApp.getState();
  const [name, setName] = useState(() => t('My junction', 'Kavşağım'));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!pending) return;
    setFailed(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeReplace();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, closeReplace]);
  if (!pending) return null;

  const go = () => {
    closeReplace();
    pending.run();
  };

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="replace-title" onClick={closeReplace}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="replace-title">{pending.what}?</h2>
        <p>
          {t(
            "This replaces your current junction. Your changes to it aren't saved yet and will be lost.",
            'Bu işlem mevcut kavşağınızın yerine geçer. Değişiklikleriniz henüz kaydedilmedi ve kaybolacak.',
          )}
        </p>
        <div className="row gap">
          <input className="text" aria-label={t('Name to save it as', 'Kaydedilecek ad')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button
            className="btn primary"
            autoFocus
            onClick={() => {
              if (!saveDesign(name.trim() || t('My junction', 'Kavşağım'), scenario)) return setFailed(true);
              markSaved();
              go();
            }}
          >
            {t('Save, then continue', 'Kaydet ve devam et')}
          </button>
        </div>
        {failed && (
          <p className="alert">
            {t("This browser won't store designs (private window?). Export it from My designs instead.", 'Bu tarayıcı tasarımları saklamıyor (gizli pencere mi?). Bunun yerine Tasarımlarım’dan dışa aktarın.')}
          </p>
        )}
        <div className="row gap confirm-actions">
          <button className="btn danger" onClick={go}>
            {t('Continue without saving', 'Kaydetmeden devam et')}
          </button>
          <button className="link" onClick={closeReplace}>
            {t('Cancel', 'İptal')}
          </button>
        </div>
      </div>
    </div>
  );
}
