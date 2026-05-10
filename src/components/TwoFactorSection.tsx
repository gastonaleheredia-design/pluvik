import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

type EnrollState =
  | { kind: 'idle' }
  | { kind: 'enrolling'; factorId: string; qr: string; secret: string };

export function TwoFactorSection() {
  const { t } = useTranslation();
  const [hasFactor, setHasFactor] = useState(false);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<EnrollState>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === 'verified');
    setHasFactor(!!verified);
    setVerifiedFactorId(verified?.id ?? null);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleStartEnroll = async () => {
    setMsg(null);
    setBusy(true);
    // Clean up any unverified factors first to avoid "already exists" errors
    const { data: list } = await supabase.auth.mfa.listFactors();
    const stale = list?.totp?.filter((f) => f.status !== 'verified') ?? [];
    for (const f of stale) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Pluvik ${Date.now()}`,
    });
    setBusy(false);
    if (error || !data) {
      setMsg({ kind: 'err', text: error?.message ?? 'Failed to start enrollment.' });
      return;
    }
    setEnroll({
      kind: 'enrolling',
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    });
  };

  const handleVerifyEnroll = async () => {
    if (enroll.kind !== 'enrolling' || code.length < 6) return;
    setBusy(true);
    setMsg(null);
    const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({
      factorId: enroll.factorId,
    });
    if (chalErr || !chal) {
      setBusy(false);
      setMsg({ kind: 'err', text: chalErr?.message ?? 'Challenge failed.' });
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: chal.id,
      code,
    });
    setBusy(false);
    if (error) {
      setMsg({ kind: 'err', text: t('auth.mfa_invalid_code') });
      setCode('');
      return;
    }
    setMsg({ kind: 'ok', text: t('auth.mfa_enabled') });
    setEnroll({ kind: 'idle' });
    setCode('');
    await refresh();
  };

  const handleDisable = async () => {
    if (!verifiedFactorId) return;
    if (!confirm(t('auth.mfa_disable') + '?')) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
    setBusy(false);
    if (error) {
      setMsg({ kind: 'err', text: error.message });
      return;
    }
    setMsg({ kind: 'ok', text: t('auth.mfa_disabled') });
    await refresh();
  };

  const handleCancelEnroll = async () => {
    if (enroll.kind === 'enrolling') {
      await supabase.auth.mfa.unenroll({ factorId: enroll.factorId });
    }
    setEnroll({ kind: 'idle' });
    setCode('');
    setMsg(null);
  };

  return (
    <div className="mt-6 mb-5 pt-5 border-t border-[rgba(11,16,24,0.08)]">
      <p className="text-xs text-neutral-gray mb-1">{t('auth.mfa_section')}</p>
      <p className="text-[0.7rem] text-neutral-gray mb-3 italic">{t('auth.mfa_sub')}</p>

      <p className="text-sm text-ink mb-3">
        {hasFactor ? '🔒 ' + t('auth.mfa_status_on') : '🔓 ' + t('auth.mfa_status_off')}
      </p>

      {enroll.kind === 'enrolling' && (
        <div className="mb-3 p-4 rounded-xl bg-[#f0ebde] border border-[rgba(11,16,24,0.08)]">
          <p className="text-xs text-ink mb-3">{t('auth.mfa_qr_instructions')}</p>
          <div
            className="bg-white p-3 rounded-lg flex justify-center mb-3"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: enroll.qr }}
          />
          <p className="text-[0.65rem] text-neutral-gray mb-1">{t('auth.mfa_secret_label')}</p>
          <p className="text-xs font-mono text-ink mb-3 break-all bg-paper p-2 rounded">{enroll.secret}</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder={t('auth.mfa_code_placeholder')}
            className="w-full p-3 rounded-xl bg-paper border border-[rgba(11,16,24,0.1)] text-base text-center tracking-widest mb-2 outline-none"
          />
          <button
            onClick={handleVerifyEnroll}
            disabled={busy || code.length < 6}
            className="w-full py-2.5 rounded-full font-medium text-sm bg-ink text-paper disabled:bg-neutral-gray-light disabled:text-neutral-gray mb-2"
          >
            {busy ? t('auth.loading') : t('auth.mfa_verify')}
          </button>
          <button onClick={handleCancelEnroll} className="w-full py-2 text-xs text-neutral-gray">
            {t('auth.mfa_cancel')}
          </button>
        </div>
      )}

      {enroll.kind === 'idle' && !hasFactor && (
        <button
          onClick={handleStartEnroll}
          disabled={busy}
          className="w-full py-2.5 rounded-full font-medium text-sm bg-ink text-paper"
        >
          {busy ? t('auth.loading') : t('auth.mfa_enable')}
        </button>
      )}

      {enroll.kind === 'idle' && hasFactor && (
        <button
          onClick={handleDisable}
          disabled={busy}
          className="w-full py-2.5 rounded-full font-medium text-sm border border-[#b91c1c] text-[#b91c1c] bg-paper"
        >
          {busy ? t('auth.loading') : t('auth.mfa_disable')}
        </button>
      )}

      {msg && (
        <div className={`text-xs mt-2 ${msg.kind === 'ok' ? 'text-[#15803d]' : 'text-[#b91c1c]'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}