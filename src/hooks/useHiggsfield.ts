import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { File, Paths } from 'expo-file-system';

import {
  checkHiggsfieldReply, exactHiggsfieldCost, higgsfieldCreditLabel, higgsfieldJobPending,
  makeHiggsfieldVideoParams, videoModelsFromCatalog,
  type HiggsfieldCatalogModel, type HiggsfieldGeneration, type HiggsfieldReply,
  type HiggsfieldVideoModel, type HiggsfieldVideoParams, type HiggsfieldWorkspace,
} from '../higgsfield';
import { connectHiggsfield, disconnectHiggsfield, readHiggsfieldSession } from '../higgsfieldAuth';
import { createHiggsfieldClient, importHiggsfieldInflu, uploadHiggsfieldVideo } from '../higgsfieldMedia';
import type { PickedVideo } from '../mediaPicker';
import { errorMessage } from '../utils';

interface Quote {
  key: string;
  params: HiggsfieldVideoParams;
  credits: number;
  workspaceId: string;
}
interface SavedGeneration {
  workspaceId: string;
  job: HiggsfieldGeneration | null;
  uncertain: boolean;
}

function savedJobFile() { return new File(Paths.document, 'scaylit-higgsfield-job-v1.json'); }
function saveGeneration(value: SavedGeneration) {
  const file = savedJobFile();
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(value));
}
function readGeneration(workspaceId: string): SavedGeneration | null {
  try {
    const file = savedJobFile();
    if (!file.exists) return null;
    const value = JSON.parse(file.textSync()) as SavedGeneration;
    if (value.workspaceId !== workspaceId || typeof value.uncertain !== 'boolean') return null;
    if (value.job && (typeof value.job.id !== 'string' || typeof value.job.status !== 'string')) return null;
    return value;
  } catch { return null; }
}
function currentWorkspace(workspaces: HiggsfieldWorkspace[]) {
  return workspaces.find(workspace => workspace.is_selected) ?? workspaces.find(workspace => workspace.type === 'private');
}

export function useHiggsfield({ active, modelId, prompt, format, duration, video, influUrl }: {
  active: boolean; modelId: string; prompt: string; format: string; duration: number;
  video: PickedVideo | null; influUrl: string | undefined;
}) {
  const client = useRef(createHiggsfieldClient());
  const uploads = useRef(new Map<string, Promise<string>>());
  const accountVersion = useRef(0);
  const checkedSession = useRef(false);
  const connectingRef = useRef(false);
  const submittingRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<HiggsfieldVideoModel[]>([]);
  const [workspace, setWorkspace] = useState<HiggsfieldWorkspace | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<HiggsfieldGeneration | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const model = models.find(item => item.id === modelId) ?? models[0] ?? null;
  const pending = higgsfieldJobPending(job);
  const formKey = JSON.stringify([workspace?.id, model?.id, model?.defaults, prompt.trim(), format, duration, video?.uri, influUrl]);
  const formKeyRef = useRef(formKey);
  formKeyRef.current = formKey;
  const currentQuote = quote?.key === formKey ? quote : null;
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const quotedTick = useRef(-1);

  const refresh = useCallback(async () => {
    if (submittingRef.current) return;
    const version = accountVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [balanceReply, workspaceReply] = await Promise.all([
        client.current.call<{ credits?: number; error?: string }>('balance', {}),
        client.current.call<{ workspaces?: HiggsfieldWorkspace[]; error?: string }>('list_workspaces', {}),
      ]);
      checkHiggsfieldReply(balanceReply);
      checkHiggsfieldReply(workspaceReply);
      const current = currentWorkspace(workspaceReply.workspaces ?? []);
      if (!current) throw new Error('Higgsfield n’a pas renvoyé ton espace de travail.');
      const items: HiggsfieldCatalogModel[] = [];
      let after: string | undefined;
      do {
        const page = checkHiggsfieldReply(await client.current.call<{
          items?: HiggsfieldCatalogModel[]; has_more?: boolean; next_page_token?: string; error?: string;
        }>('models_explore', { action: 'list', type: 'video', limit: 100, ...(after ? { after } : {}) }));
        items.push(...(page.items ?? []));
        after = page.has_more ? page.next_page_token : undefined;
      } while (after);
      if (version !== accountVersion.current) return;
      const available = videoModelsFromCatalog(items);
      if (!available.length) throw new Error('Aucun modèle compatible avec une vidéo et une photo n’est disponible.');
      setModels(available);
      setWorkspace(current);
      setBalance(typeof balanceReply.credits === 'number' ? balanceReply.credits : null);
      const saved = readGeneration(current.id);
      setJob(saved?.job ?? null);
      setUncertain(saved?.uncertain ?? false);
      setRefreshTick(tick => tick + 1);
    } catch (error) {
      if (version === accountVersion.current) setError(errorMessage(error, 'Connexion Higgsfield indisponible.'));
    } finally { if (version === accountVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!active || checkedSession.current) return;
    checkedSession.current = true;
    void readHiggsfieldSession().then(session => {
      setConnected(!!session);
      if (session) void refresh();
    }).catch(error => setError(errorMessage(error)));
  }, [active, refresh]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);

  const connect = async () => {
    if (connectingRef.current || submittingRef.current || pending) return;
    connectingRef.current = true;
    setConnecting(true);
    setError(null);
    try {
      if (!await connectHiggsfield()) return;
      accountVersion.current += 1;
      client.current = createHiggsfieldClient();
      uploads.current.clear();
      setQuote(null);
      setConnected(true);
      await refresh();
    } catch (error) { setError(errorMessage(error, 'Connexion Higgsfield impossible.')); }
    finally { connectingRef.current = false; setConnecting(false); }
  };

  const disconnect = async () => {
    if (submittingRef.current || pending) return;
    accountVersion.current += 1;
    setConnected(false); setWorkspace(null); setModels([]); setBalance(null); setQuote(null); setJob(null); setUncertain(false); setError(null);
    uploads.current.clear();
    client.current = createHiggsfieldClient();
    try { await disconnectHiggsfield(); } catch (error) { setError(errorMessage(error)); }
  };

  useEffect(() => {
    // Hidden tab: keep the current quote instead of uploading and pricing again on return.
    if (!active) return;
    const ready = connected && !pending && !uncertain && !submitting;
    if (ready && quoteRef.current?.key === formKey && quotedTick.current === refreshTick) return;
    let cancelled = false;
    setQuote(null); setQuoteError(null); setQuoting(false);
    if (!connected || !workspace || !model || !video || !influUrl || !prompt.trim() || pending || uncertain || submitting) return;
    const version = accountVersion.current;
    const getUpload = (key: string, upload: () => Promise<string>) => {
      let task = uploads.current.get(key);
      if (!task) {
        task = upload().catch(error => { uploads.current.delete(key); throw error; });
        uploads.current.set(key, task);
      }
      return task;
    };
    const timeout = setTimeout(() => {
      setQuoting(true);
      void (async () => {
        const [videoId, imageId] = await Promise.all([
          getUpload(`${workspace.id}:video:${video.uri}`, () => uploadHiggsfieldVideo(client.current, video)),
          getUpload(`${workspace.id}:image:${influUrl}`, () => importHiggsfieldInflu(client.current, influUrl)),
        ]);
        if (cancelled || version !== accountVersion.current) return;
        const params = makeHiggsfieldVideoParams(model, prompt, format, duration, videoId, imageId);
        const reply = await client.current.call<HiggsfieldReply>('generate_video', { params: { ...params, get_cost: true } });
        const credits = exactHiggsfieldCost(reply);
        if (!cancelled && version === accountVersion.current) {
          quotedTick.current = refreshTick;
          setQuote({ key: formKey, params, credits, workspaceId: workspace.id });
        }
      })().catch(error => {
        if (!cancelled && version === accountVersion.current) setQuoteError(errorMessage(error, 'Coût indisponible.'));
      }).finally(() => { if (!cancelled) setQuoting(false); });
    }, 600);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [active, connected, workspace, model, video, influUrl, prompt, format, duration, formKey, pending, uncertain, submitting, refreshTick]);

  const generate = async () => {
    const approved = currentQuote;
    if (!approved || submittingRef.current || pending || uncertain) return;
    submittingRef.current = true;
    setSubmitting(true); setError(null);
    let sent = false;
    let replied = false;
    let acceptedJob: HiggsfieldGeneration | null = null;
    try {
      const workspaces = checkHiggsfieldReply(await client.current.call<{ workspaces?: HiggsfieldWorkspace[]; error?: string }>('list_workspaces', {}));
      if (currentWorkspace(workspaces.workspaces ?? [])?.id !== approved.workspaceId) throw new Error('Ton espace Higgsfield a changé. Actualise avant de générer.');
      const latest = exactHiggsfieldCost(await client.current.call<HiggsfieldReply>('generate_video', { params: { ...approved.params, get_cost: true } }));
      if (formKeyRef.current !== approved.key) throw new Error('Les réglages ont changé. Vérifie le nouveau coût.');
      if (latest > approved.credits) {
        setQuote({ ...approved, credits: latest });
        throw new Error(`Le tarif est maintenant de ${higgsfieldCreditLabel(latest)} crédits. Vérifie-le avant de générer.`);
      }
      if (balance !== null && latest > balance) throw new Error('Ton solde Higgsfield est insuffisant.');
      saveGeneration({ workspaceId: approved.workspaceId, job: null, uncertain: true });
      sent = true;
      const reply = await client.current.call<HiggsfieldReply>('generate_video', { params: { ...approved.params, get_cost: false } });
      replied = true;
      checkHiggsfieldReply(reply);
      const created = reply.results?.[0];
      if (!created?.id) {
        replied = false;
        throw new Error('Higgsfield n’a pas renvoyé le numéro de génération. Vérifie tes vidéos avant de relancer.');
      }
      acceptedJob = created;
      setJob(created);
      saveGeneration({ workspaceId: approved.workspaceId, job: created, uncertain: false });
      setQuote(null);
      void client.current.call<{ credits?: number }>('balance', {}).then(reply => {
        if (typeof reply.credits === 'number') setBalance(reply.credits);
      }).catch(() => undefined);
    } catch (error) {
      setError(errorMessage(error, 'Génération impossible.'));
      if (acceptedJob) {
        // Keep the known job in memory if local storage fails; polling can save it again.
        setUncertain(false);
      } else if (sent) {
        setUncertain(!replied);
        try { saveGeneration({ workspaceId: approved.workspaceId, job: null, uncertain: !replied }); }
        catch { /* The pre-submission record still prevents an automatic duplicate. */ }
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  const jobId = job?.id;
  useEffect(() => {
    if (!active || !jobId || !pending || !connected || !workspace || !foreground) return;
    let cancelled = false;
    const version = accountVersion.current;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 10_000;
      try {
        const reply = checkHiggsfieldReply(await client.current.call<{
          generation?: HiggsfieldGeneration; poll_after_seconds?: number; error?: string;
        }>('job_status', { jobId }));
        if (cancelled) return;
        if (reply.generation?.id !== jobId) throw new Error('Le suivi Higgsfield n’a pas renvoyé la bonne vidéo.');
        setJob(reply.generation); setError(null);
        saveGeneration({ workspaceId: workspace.id, job: reply.generation, uncertain: false });
        if (!higgsfieldJobPending(reply.generation)) {
          void client.current.call<{ credits?: number }>('balance', {}).then(balance => {
            if (version === accountVersion.current && typeof balance.credits === 'number') setBalance(balance.credits);
          }).catch(() => undefined);
          return;
        }
        if (typeof reply.poll_after_seconds === 'number') delay = Math.max(5_000, reply.poll_after_seconds * 1000);
      } catch (error) { if (!cancelled) setError(errorMessage(error, 'Le suivi reprendra à la prochaine connexion.')); }
      if (!cancelled) timeout = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [active, jobId, pending, connected, workspace, foreground]);

  const clearJob = () => {
    if (pending || submittingRef.current) return;
    try {
      if (workspace) saveGeneration({ workspaceId: workspace.id, job: null, uncertain: false });
      setJob(null); setUncertain(false); setError(null);
    } catch (error) { setError(errorMessage(error, 'Impossible d’enregistrer la vérification. Réessaie.')); }
  };

  return { connected, connecting, loading, connect, disconnect, refresh, models, model, workspace, balance,
    quote: currentQuote, quoting, quoteError, error, job, pending, uncertain, submitting, generate, clearJob,
    retryQuote: () => setRefreshTick(tick => tick + 1) };
}
