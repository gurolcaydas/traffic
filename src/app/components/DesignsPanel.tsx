import { useEffect, useRef, useState } from 'react';
import { getLang, t } from '../../core/i18n';
import { readShared, shareHash, sharedPayload } from '../../scenarios/share';
import { deleteDesign, designFile, listDesigns, parseScenario, saveDesign, type SavedDesign } from '../../scenarios/storage';
import { useRules } from '../levelRules';
import { useApp } from '../store';

/** Save the sandbox design in this browser, load it back, or take it elsewhere as a file. */
export function DesignsPanel() {
  const rules = useRules();
  const scenario = useApp((s) => s.scenario);
  const savedDesign = useApp((s) => s.savedDesign);
  const { loadDesign, askReplace, markSaved } = useApp.getState();
  const [designs, setDesigns] = useState<SavedDesign[]>(() => listDesigns());
  const [name, setName] = useState(() => t('My junction', 'Kavşağım'));
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // A design saved from the "unsaved changes" question shows up here too.
  useEffect(() => setDesigns(listDesigns()), [savedDesign]);
  // Open a design from a shared link, on page load or when a link is pasted into this tab.
  useEffect(() => {
    const openFromHash = async () => {
      const payload = sharedPayload(location.hash);
      if (!payload) return;
      // Drop the hash first, so a reload or a second effect run doesn't open the design again over later edits.
      history.replaceState(null, '', location.pathname + location.search);
      const parsed = await readShared(payload);
      if (!parsed.scenario) return setMessage({ text: parsed.error ?? t('Could not read that link.', 'Bu bağlantı okunamadı.'), bad: true });
      const n = parsed.name ?? t('Shared design', 'Paylaşılan tasarım');
      useApp.getState().askReplace(t(`Open “${n}”`, `“${n}” aç`), () => {
        useApp.getState().loadDesign(parsed.scenario!);
        setName(n);
        setMessage({ text: t(`Opened the shared design “${n}”.`, `Paylaşılan “${n}” tasarımı açıldı.`) });
      });
    };
    const onHash = () => void openFromHash();
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (rules.inLevel) return null;

  const save = () => {
    const n = name.trim() || t('My junction', 'Kavşağım');
    if (saveDesign(n, scenario)) {
      markSaved();
      setDesigns(listDesigns());
      setMessage({ text: t(`Saved “${n}”.`, `“${n}” kaydedildi.`) });
    } else setMessage({ text: t("This browser won't store designs (private window?). Use Export instead.", 'Bu tarayıcı tasarımları saklamıyor (gizli pencere mi?). Bunun yerine Dışa aktar’ı kullanın.'), bad: true });
  };

  const exportFile = () => {
    const n = name.trim() || t('My junction', 'Kavşağım');
    const url = URL.createObjectURL(new Blob([designFile(n, scenario)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${n.replace(/[^\p{L}\p{N}_-]+/gu, '-').toLocaleLowerCase()}.traffic.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLink = async () => {
    const n = name.trim() || t('My junction', 'Kavşağım');
    const url = location.origin + location.pathname + (await shareHash(n, scenario));
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: t('Link copied. Anyone who opens it gets this design.', 'Bağlantı kopyalandı. Açan herkes bu tasarımı görür.') });
    } catch {
      // No clipboard access (an insecure page, or permission refused): leave the link in the address bar instead.
      history.replaceState(null, '', url);
      setMessage({ text: t('Copy the link from the address bar.', 'Bağlantıyı adres çubuğundan kopyalayın.') });
    }
  };

  const importFile = async (file: File) => {
    try {
      const parsed = parseScenario(JSON.parse(await file.text()));
      if (!parsed.scenario) return setMessage({ text: parsed.error ?? t('Could not read that file.', 'Bu dosya okunamadı.'), bad: true });
      const n = parsed.name ?? file.name;
      askReplace(t(`Open “${n}”`, `“${n}” aç`), () => {
        loadDesign(parsed.scenario!);
        if (parsed.name) setName(parsed.name);
        setMessage({ text: t(`Opened “${n}”.`, `“${n}” açıldı.`) });
      });
    } catch {
      setMessage({ text: t('That file is not valid JSON.', 'Bu dosya geçerli bir JSON değil.'), bad: true });
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{t('My designs', 'Tasarımlarım')}</h2>
        <span className="hint">{t('Saved in this browser', 'Bu tarayıcıda saklanır')}</span>
      </header>
      <div className="row gap">
        <input className="text" aria-label={t('Design name', 'Tasarım adı')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn primary" onClick={save}>
          {t('Save', 'Kaydet')}
        </button>
      </div>
      {message && <p className={message.bad ? 'alert' : 'hint'}>{message.text}</p>}
      {designs.length > 0 && (
        <ul className="design-list">
          {designs.map((d) => (
            <li key={d.id}>
              <span className="design-name">{d.name}</span>
              <span className="hint">
                {d.scenario.legs.length} {t('roads', 'yol')} · {new Date(d.savedAt).toLocaleDateString(getLang())}
              </span>
              <button className="link" onClick={() => askReplace(t(`Open “${d.name}”`, `“${d.name}” aç`), () => loadDesign(d.scenario))}>
                {t('Open', 'Aç')}
              </button>
              <button
                className="link danger"
                aria-label={t(`Delete ${d.name}`, `${d.name} sil`)}
                onClick={() => {
                  deleteDesign(d.id);
                  setDesigns(listDesigns());
                }}
              >
                {t('Delete', 'Sil')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row gap design-actions">
        <button className="btn" onClick={() => void copyLink()} title={t('Copy a link that opens this design', 'Bu tasarımı açan bir bağlantı kopyala')}>
          {t('Copy link', 'Bağlantı kopyala')}
        </button>
        <button className="btn" onClick={exportFile} title={t('Download this design as a file', 'Bu tasarımı dosya olarak indir')}>
          {t('Export file', 'Dışa aktar')}
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()} title={t('Open a design from a file', 'Dosyadan bir tasarım aç')}>
          {t('Import file', 'İçe aktar')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}
