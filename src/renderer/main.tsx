import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StudioEvent, IssueProgressEvent } from '../main/preload';
import type { Project, ControllerSnapshot, RunRecord, StudioIssue, SimulationResult, IssueCodeResult, IssueVerificationResult, DraftIssuePrResult, IssueAutomationOutcome, GitPreflight, ProviderDiagnostics, StandaloneStatus, StudioActivity, SandboxProbeResult, ReviewerToolProbe, IsolatedQualityProbe, QualityScriptProbeResult, FullPipelineProbeResult, OfflineKiloProbeResult, OfflineReviewerProbeResult, LocalReviewModelProbeResult, ReviewerCalibrationResult, OllamaReadinessResult, KiloFreeCatalog, KiloRoleModels, KiloFreeUsage, FreeRunReadiness, FreeRoutePreview, IssueQueuePreview, BranchProtectionStatus, PublicHistoryIndex, LearningBookPreview, IssueStatusPreview, TechStackProfilePreview } from './global';
import type {DeepLearningProgress} from '../main/preload';
import './style.css';
import {ScrollJumpControls} from './scroll-jump-controls';
import {formatIssueFailure} from './issue-error-diagnostics';
import {formatLearningDuration,formatRemainingEta} from './learning-time';
import {explainIssueHold} from './issue-hold-explanation';

type Tab = 'overview' | 'agents' | 'logs' | 'history' | 'issues' | 'learning';
type RunMode = 'status' | 'dry-run' | 'execute';
interface ActiveRun { projectId: string; mode: string; startedAt: number }

function App(): React.JSX.Element {
  const scrollScopeRef=React.useRef<HTMLElement|null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(() => localStorage.getItem('autodev:selected') ?? '');
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<StudioEvent[]>([]);
  const [issueProgress, setIssueProgress] = useState<IssueProgressEvent | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [issues, setIssues] = useState<StudioIssue[]>([]);
  const [learningInput, setLearningInput] = useState('');
  const [learningHistory, setLearningHistory] = useState<PublicHistoryIndex | null>(null);
  const [learningBook, setLearningBook] = useState<LearningBookPreview|null>(null);
  const [learningGenerating,setLearningGenerating] = useState(false);
  const [learningProvider,setLearningProvider] = useState<'ollama'|'kilo'>('ollama');
  const [learningCloudConsent,setLearningCloudConsent] = useState(false);
  const [learningProgress,setLearningProgress] = useState<DeepLearningProgress|null>(null);
  const [learningModalOpen,setLearningModalOpen] = useState(false);
  const [learningStartedAt,setLearningStartedAt] = useState(0);
  const [learningEtaReceivedAt,setLearningEtaReceivedAt] = useState(0);
  const [learningModalError,setLearningModalError] = useState('');
  const [learningExporting,setLearningExporting] = useState(false);
  const [learningMessage,setLearningMessage] = useState('');
  const [learningLoading, setLearningLoading] = useState(false);
  const [learningError, setLearningError] = useState('');
  const [gitStatus, setGitStatus] = useState<GitPreflight | null>(null);
  const [branchProtection, setBranchProtection] = useState<BranchProtectionStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [sandboxProbe, setSandboxProbe] = useState<SandboxProbeResult | null>(null);
  const [sandboxChecking, setSandboxChecking] = useState(false);
  const [sandboxError, setSandboxError] = useState('');
  const [reviewerProbe, setReviewerProbe] = useState<ReviewerToolProbe | null>(null);
  const [reviewerChecking, setReviewerChecking] = useState(false);
  const [qualityProbe, setQualityProbe] = useState<IsolatedQualityProbe | null>(null);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualityScriptProbe, setQualityScriptProbe] = useState<QualityScriptProbeResult | null>(null);
  const [qualityScriptChecking, setQualityScriptChecking] = useState(false);
  const [fullPipelineProbe, setFullPipelineProbe] = useState<FullPipelineProbeResult | null>(null);
  const [fullPipelineChecking, setFullPipelineChecking] = useState(false);
  const [offlineKiloProbe, setOfflineKiloProbe] = useState<OfflineKiloProbeResult | null>(null);
  const [offlineKiloChecking, setOfflineKiloChecking] = useState(false);
  const [offlineReviewerProbe, setOfflineReviewerProbe] = useState<OfflineReviewerProbeResult | null>(null);
  const [offlineReviewerChecking, setOfflineReviewerChecking] = useState(false);
  const [localModelProbe, setLocalModelProbe] = useState<LocalReviewModelProbeResult | null>(null);
  const [localModelChecking, setLocalModelChecking] = useState(false);
  const [calibration, setCalibration] = useState<ReviewerCalibrationResult | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [ollamaReadiness, setOllamaReadiness] = useState<OllamaReadinessResult | null>(null);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [kiloModels, setKiloModels] = useState<KiloFreeCatalog | null>(null);
  const [kiloModelLoading, setKiloModelLoading] = useState(false);
  const [kiloModelError, setKiloModelError] = useState('');
  const [kiloUsage, setKiloUsage] = useState<KiloFreeUsage | null>(null);
  const [kiloUsageError, setKiloUsageError] = useState('');
  const [savedRoleModels, setSavedRoleModels] = useState<KiloRoleModels | null>(null);
  const [draftRoleModels, setDraftRoleModels] = useState<KiloRoleModels>({planner:'',builder:'',reviewer:''});
  const [savingRoleModels, setSavingRoleModels] = useState(false);
  const [roleModelsMessage, setRoleModelsMessage] = useState('');
  const [kiloCalibration, setKiloCalibration] = useState<ReviewerCalibrationResult | null>(null);
  const [kiloCalibrating, setKiloCalibrating] = useState(false);
  const [readiness, setReadiness] = useState<FreeRunReadiness | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readinessError, setReadinessError] = useState('');
  const [localFallback, setLocalFallback] = useState(false);
  const [savingLocalFallback, setSavingLocalFallback] = useState(false);
  const [routePreview, setRoutePreview] = useState<FreeRoutePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [gitError, setGitError] = useState('');
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [stackProfile,setStackProfile] = useState<TechStackProfilePreview|null>(null);
  const [stackProfileError,setStackProfileError] = useState('');
  const [labelsInstalling,setLabelsInstalling] = useState(false);
  const [labelsResult,setLabelsResult] = useState('');
  const [labelsError,setLabelsError] = useState('');
  const [issueQueue, setIssueQueue] = useState<IssueQueuePreview | null>(null);
  const [issueStatusPreviews,setIssueStatusPreviews]=useState<IssueStatusPreview[]>([]);
  const [simulating, setSimulating] = useState<number | null>(null);
  const [codingIssue, setCodingIssue] = useState<number | null>(null);
  const [codeResult, setCodeResult] = useState<IssueCodeResult | null>(null);
  const [codeError, setCodeError] = useState('');
  const [verifyingIssue, setVerifyingIssue] = useState<number | null>(null);
  const [verificationResult, setVerificationResult] = useState<IssueVerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const [publishingIssue, setPublishingIssue] = useState<number | null>(null);
  const [draftPr, setDraftPr] = useState<DraftIssuePrResult | null>(null);
  const [draftPrError, setDraftPrError] = useState('');
  const [automatingIssue, setAutomatingIssue] = useState<number | null>(null);
  const [automationResult, setAutomationResult] = useState<IssueAutomationOutcome | null>(null);
  const [automationError, setAutomationError] = useState('');
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [issuesError, setIssuesError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyRun, setHistoryRun] = useState<string | null>(null);
  const [savedLog, setSavedLog] = useState('');
  const [activeInfo, setActiveInfo] = useState<ActiveRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<ControllerSnapshot | null>(null);
  const [studioStatus, setStudioStatus] = useState<StandaloneStatus | null>(null);
  const [studioActivity, setStudioActivity] = useState<StudioActivity | null>(null);
  const [studioStatusError, setStudioStatusError] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  const [approval, setApproval] = useState('');

  const project = projects.find(p => p.id === selected);
  const canRun = Boolean(project?.hasCore);
  const elapsed = activeInfo ? Math.max(0, Math.floor((clock - activeInfo.startedAt) / 1000)) : 0;
  const duration = [Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60]
    .map(n => String(n).padStart(2, '0')).join(':');

  const refresh = async (): Promise<void> => {
    const all = await window.studio.projects();
    setProjects(all);
    setSelected(current => all.some(p => p.id === current)
      ? current : (all.find(p => p.id === localStorage.getItem('autodev:selected'))?.id ?? all[0]?.id ?? ''));
  };

  useEffect(() => {
    void refresh().catch(e => setError(String(e)));
    void window.studio.runInfo().then(info => {
      setBusy(Boolean(info));
      setActiveInfo(info);
    }).catch(e => setError(String(e)));
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    const unsubscribe = window.studio.onEvent(event => {
      setEvents(previous => [...previous.slice(-1999), event]);
      if (event.type === 'start') {
        setBusy(true);
        setActiveInfo({ projectId: event.projectId ?? '', mode: event.mode ?? 'unknown', startedAt: event.time });
      }
      if (event.type === 'exit') {
        setBusy(false);
        setActiveInfo(null);
      }
    });
    const unsubscribeLearning=window.studio.onLearningProgress(event=>{
      setLearningProgress(event);
      setLearningEtaReceivedAt(Date.now());
    });
    const unsubscribeIssue=window.studio.onIssueProgress(event=>{
      if(Number.isSafeInteger(event.issueNumber)&&event.issueNumber>0)
        setIssueProgress(event);
    });
    return () => { clearInterval(ticker); unsubscribe(); unsubscribeIssue(); unsubscribeLearning(); };
  }, []);

  useEffect(() => {
    if (selected) localStorage.setItem('autodev:selected', selected);
    else localStorage.removeItem('autodev:selected');
    setConfirmOpen(false);
    setApproval('');
    setSnapshot(null);
    setSnapshotError('');
    setStudioStatus(null);
    setStudioActivity(null);
    setStudioStatusError('');
    setHistory([]);
    setIssues([]);
    setIssuesError('');
    setIssueProgress(null);
    setCodeResult(null);
    setCodeError('');
    setVerificationResult(null);
    setVerificationError('');
    setDraftPr(null);
    setDraftPrError('');
    setAutomationResult(null);
    setAutomationError('');
    setGitStatus(null);
    setBranchProtection(null);
    setGitError('');
    setDiagnostics(null);
    setDiagnosticsError('');
    setSandboxProbe(null);
    setSandboxError('');
    setReviewerProbe(null);
    setQualityProbe(null);
    setQualityScriptProbe(null);
    setFullPipelineProbe(null);
    setOfflineKiloProbe(null);
    setOfflineReviewerProbe(null);
    setLocalModelProbe(null);
    setCalibration(null);
    setOllamaReadiness(null);
    setKiloModels(null);
    setKiloModelError('');
    setKiloUsage(null);
    setKiloUsageError('');
    setSavedRoleModels(null);
    setDraftRoleModels({planner:'',builder:'',reviewer:''});
    setRoleModelsMessage('');
    setKiloCalibration(null);
    setReadiness(null);
    setReadinessError('');
    setLocalFallback(false);
    setRoutePreview(null);
    setPreviewError('');
    setSimulation(null);
    setHistoryRun(null);
    setSavedLog('');
    setHistoryError('');
    if (!selected) return;
    let cancelled = false;
    const reload = (): void => {
      void window.studio.snapshot(selected).then(value => {
        if (!cancelled) { setSnapshot(value); setSnapshotError(''); }
      }).catch(e => { if (!cancelled) setSnapshotError(String(e)); });
    };
    reload();
    const refreshStandalone = (): void => {
      void window.studio.studioStatus(selected).then(value => {
        if (!cancelled) { setStudioStatus(value); setStudioStatusError(''); }
      }).catch(e => { if (!cancelled) setStudioStatusError(String(e)); });
    };
    refreshStandalone();
    const refreshHistory = (): void => {
      void window.studio.history(selected).then(records => {
        if (!cancelled) { setHistory(records); setHistoryError(''); }
      }).catch(e => { if (!cancelled) setHistoryError(String(e)); });
    };
    refreshHistory();
    const timer = setInterval(() => { reload(); refreshStandalone(); refreshHistory(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected]);

  const installLabels = async ():Promise<void>=>{
    if(!selected||labelsInstalling||branchProtection?.protected!==true)return;
    setLabelsInstalling(true);setLabelsResult('');setLabelsError('');
    try{
      const r=await window.studio.installIssueLabels(selected);
      setLabelsResult(r.created.length===0
        ?'Alle '+r.total+' Label-Definitionen bereits vorhanden.'
        :r.created.length+' fehlende Labels in '+r.repository+' angelegt. Bestehende Issue-Labels unverändert.');
      await loadIssues();
    }catch(error){
      setLabelsError(error instanceof Error?error.message:
        'Label-Definitionen nicht eingerichtet; GitHub-Berechtigungen und Konflikte prüfen.');
    }finally{setLabelsInstalling(false);}
  };
  const loadIssues = async (): Promise<void> => {
    if (!selected) return;
    setIssuesLoading(true);
    setIssuesError('');
    setStackProfile(null);setStackProfileError('');
    void window.studio.techStackProfile(selected).then(setStackProfile)
      .catch(error=>setStackProfileError(error instanceof Error?error.message:
        'TechStack-Profil konnte nicht geprüft werden'));
    setBranchProtection(null);
    void window.studio.studioStatus(selected).then(setStudioStatus)
      .catch(()=>setStudioStatus(null));
    void window.studio.studioActivity(selected).then(setStudioActivity).catch(()=>setStudioActivity(null));
    void window.studio.branchProtection(selected).then(setBranchProtection).catch(()=>
      setBranchProtection({protected:false,reason:'GitHub-Branch-Protection konnte nicht geprüft werden'}));
    setGitError('');
    void window.studio.gitPreflight(selected).then(setGitStatus).catch(e => setGitError(String(e)));
    try {
      setIssues(await window.studio.issues(selected));
      setIssueQueue(await window.studio.issueQueue(selected));
      setIssueStatusPreviews(await window.studio.issueStatusPreviews(selected));
    }
    catch (error) { setIssuesError(String(error)); }
    finally { setIssuesLoading(false); }
  };

  const generateLearning = async ():Promise<void>=>{
    if(learningGenerating||!learningInput.trim())return;
    setLearningGenerating(true);setLearningError('');setLearningMessage('');
    setLearningProgress(null);setLearningModalError('');
    setLearningEtaReceivedAt(0);
    setLearningStartedAt(Date.now());setLearningModalOpen(true);
    try{
      const result=await window.studio.deepLearningBook(learningInput.trim(),learningProvider,
        learningProvider==='kilo'&&learningCloudConsent);
      setLearningBook(result);
      setLearningMessage('Code-Lehrbuch lokal gespeichert: '+
        (result.deepAnalysis?.filesAnalyzed??result.lessons)+' Quelldateien untersucht.');
    }catch(error){
      const raw=error instanceof Error?error.message:'Unbekannter Analysefehler';
      const message=raw.replace(/^Error invoking remote method '[^']+':\\s*(?:Error:\\s*)?/,'');
      setLearningModalError(message);
      setLearningError('KI-Analyse fehlgeschlagen: '+message);
      // Never hide already verified, locally saved partial chapters on failure.
      try{
        const repo=learningInput.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'');
        const saved=await window.studio.loadLearningBook(repo,learningProvider);
        if(saved?.deepAnalysis){
          setLearningBook(saved);
          setLearningMessage('Gesicherter Zwischenstand verfügbar: '+
            'Fertige Kapitel sind lokal gespeichert. Ein erneuter Start setzt fort.');
        }
      }catch{ /* the original model error remains visible */ }
    }finally{setLearningGenerating(false);}
  };
  const quickLearning=async():Promise<void>=>{
    if(learningGenerating||!learningInput.trim())return;
    setLearningGenerating(true);setLearningError('');setLearningMessage('');
    try{
      const result=await window.studio.generateLearningBook(learningInput.trim());
      setLearningBook(result);
      setLearningMessage('Git-Überblick gespeichert (kein tiefes Codeverständnis).');
    }catch(error){
      setLearningError(error instanceof Error?error.message:'Git-Überblick fehlgeschlagen');
    }finally{setLearningGenerating(false);}
  };
  const growLearning=async():Promise<void>=>{
    if(!learningBook?.hasMore||!learningBook.page||learningGenerating)return;
    setLearningGenerating(true);setLearningError('');setLearningMessage('');
    try{
      const next=await window.studio.generateLearningBook(
        learningBook.repository,learningBook.page+1,learningBook.head);
      setLearningBook(next);
      setLearningMessage('Weitere Commits geprüft. Das Lehrbuch enthält jetzt '+next.lessons+' Themen.');
    }catch{
      setLearningError('Weitere Historie konnte nicht analysiert werden. Der bisherige Stand bleibt unverändert.');
    }finally{setLearningGenerating(false);}
  };
  const exportLearning=async(kind:'book'|'solutions'|'reports',format:'md'|'pdf'):Promise<void>=>{
    if(!learningBook||learningExporting)return;
    setLearningExporting(true);setLearningError('');
    try{
      const done=await window.studio.exportLearningBook(learningBook.repository,kind,format,
        learningBook.deepAnalysis?
          (learningBook.deepAnalysis.model==='kilo-auto/free'?'deep-kilo':'deep'):'history');
      setLearningMessage(done.exported?'Export erfolgreich gespeichert.':'Export abgebrochen.');
    }catch{setLearningError('Export fehlgeschlagen. Zielverzeichnis und PDF-Drucker prüfen.');}
    finally{setLearningExporting(false);}
  };

  const inspectLearningHistory = async ():Promise<void> => {
    if(learningLoading || !learningInput.trim())return;
    setLearningLoading(true);
    setLearningError('');
    setLearningHistory(null);
    try{
      const result=await window.studio.publicRepoHistory(learningInput.trim(),20);
      setLearningHistory(result);
    }catch(error){
      const reason=error instanceof Error?error.message:'';
      setLearningError(reason.startsWith('Public history:')
        ?reason
        :'Öffentliche GitHub-Historie konnte nicht gelesen werden. GitHub-Verbindung und Zugriff prüfen.');
    }finally{setLearningLoading(false);}
  };

  const automateIssue = async (issueNumber:number):Promise<void> => {
    if(!selected||automatingIssue!==null||codingIssue!==null||
      verifyingIssue!==null||publishingIssue!==null)return;
    setAutomatingIssue(issueNumber);
    setIssueProgress(null);
    setAutomationResult(null);
    setAutomationError('');
    try{
      const result=await window.studio.automateDraftIssue(selected,issueNumber);
      setAutomationResult(result);
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
      void window.studio.gitPreflight(selected).then(setGitStatus).catch(()=>{});
    }catch(error){
      const classified=formatIssueFailure(error);
      if(classified.includes('[conflict]')){
        const [activity,status]=await Promise.all([
          window.studio.studioActivity(selected).catch(()=>null),
          window.studio.studioStatus(selected).catch(()=>null),
        ]);
        setStudioActivity(activity);
        if(status)setStudioStatus(status);
        if(activity?.busy){
          const origin=activity.projectId===selected?'diesem Projekt':'einem anderen Projekt';
          const detail=activity.issueNumber===null?'':', Issue #'+activity.issueNumber;
          setAutomationError(classified+' Sperrhalter: '+activity.kind+detail+' in '+origin+'.');
        }else if(status?.lock.held){
          setAutomationError(classified+' Das ausgewählte Projekt hat einen aktiven oder verwaisten Git-Projektlock.');
        }else{
          setAutomationError(classified+' Kein aktiver In-App-Lauf nachweisbar; Checkpoint und Projektlock prüfen.');
        }
      }else{
        setAutomationError(classified);
        void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
      }
    }finally{setAutomatingIssue(null);}
  };

  const createDraftPr = async (issueNumber:number):Promise<void> => {
    if(!selected||publishingIssue!==null||codingIssue!==null||verifyingIssue!==null)return;
    setPublishingIssue(issueNumber);
    setDraftPr(null);
    setDraftPrError('');
    try{
      const result=await window.studio.publishDraftIssuePr(selected,issueNumber);
      setDraftPr(result);
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
      void window.studio.gitPreflight(selected).then(setGitStatus).catch(()=>{});
    }catch(error){
      setDraftPrError(formatIssueFailure(error));
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
    }finally{setPublishingIssue(null);}
  };

  const verifyIssueCode = async (issueNumber:number):Promise<void> => {
    if(!selected||verifyingIssue!==null||codingIssue!==null)return;
    setVerifyingIssue(issueNumber);
    setVerificationError('');
    setVerificationResult(null);
    try{
      const result=await window.studio.verifyIssue(selected,issueNumber);
      setVerificationResult(result);
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
    }catch(error){
      setVerificationError(formatIssueFailure(error));
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
    }finally{setVerifyingIssue(null);}
  };

  const convertIssueToCode = async (issueNumber:number):Promise<void> => {
    if(!selected||codingIssue!==null||simulating!==null)return;
    setCodingIssue(issueNumber);
    setCodeResult(null);
    setCodeError('');
    try{
      const result=await window.studio.issueToCode(selected,issueNumber);
      setCodeResult(result);
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
      void window.studio.gitPreflight(selected).then(setGitStatus).catch(()=>{});
    }catch(error){
      setCodeError(formatIssueFailure(error));
      void window.studio.studioStatus(selected).then(setStudioStatus).catch(()=>{});
    }finally{setCodingIssue(null);}
  };

  const simulate = async (issueNumber: number): Promise<void> => {
    if (!selected || simulating !== null) return;
    setSimulating(issueNumber);
    setSimulation(null);
    setIssuesError('');
    try { setSimulation(await window.studio.simulateIssue(selected, issueNumber)); }
    catch (error) { setIssuesError(String(error)); }
    finally { setSimulating(null); }
  };

  const checkProviders = async (): Promise<void> => {
    if (!selected || checkingProviders) return;
    setCheckingProviders(true);
    setDiagnosticsError('');
    try { setDiagnostics(await window.studio.diagnostics(selected)); }
    catch (error) { setDiagnosticsError(String(error)); }
    finally { setCheckingProviders(false); }
  };

  const verifySandbox = async (): Promise<void> => {
    if (!selected || sandboxChecking) return;
    setSandboxChecking(true);
    setSandboxError('');
    setSandboxProbe(null);
    try { setSandboxProbe(await window.studio.sandboxProbe(selected)); }
    catch { setSandboxError('Sandbox-Test konnte nicht abgeschlossen werden.'); }
    finally { setSandboxChecking(false); }
  };

  const verifyReviewer = async (): Promise<void> => {
    if (!selected || reviewerChecking) return;
    setReviewerChecking(true);
    setReviewerProbe(null);
    try { setReviewerProbe(await window.studio.reviewerProbe(selected)); }
    catch { setReviewerProbe({supported:true,passed:false,reason:'tool-failed',detail:'sandbox-launch-failed'}); }
    finally { setReviewerChecking(false); }
  };

  const verifyQualitySandbox = async (): Promise<void> => {
    if (!selected || qualityChecking) return;
    setQualityChecking(true);
    setQualityProbe(null);
    try { setQualityProbe(await window.studio.qualityProbe(selected)); }
    catch { setQualityProbe({supported:true,passed:false,reason:'sandbox-failed',stage:'prepare',detail:'other',exitCode:null}); }
    finally { setQualityChecking(false); }
  };

  const verifyQualityScript = async (): Promise<void> => {
    if (!selected || qualityScriptChecking) return;
    setQualityScriptChecking(true);
    setQualityScriptProbe(null);
    try { setQualityScriptProbe(await window.studio.qualityScriptProbe(selected)); }
    catch { setQualityScriptProbe({passed:false,reason:'script-failed'}); }
    finally { setQualityScriptChecking(false); }
  };

  const verifyFullPipeline = async (): Promise<void> => {
    if (!selected || fullPipelineChecking) return;
    setFullPipelineChecking(true);
    setFullPipelineProbe(null);
    try { setFullPipelineProbe(await window.studio.fullPipelineProbe(selected)); }
    catch { setFullPipelineProbe({passed:false,reason:'pipeline-failed'}); }
    finally { setFullPipelineChecking(false); }
  };

  const verifyOfflineKilo = async (): Promise<void> => {
    if (!selected || offlineKiloChecking) return;
    setOfflineKiloChecking(true);
    setOfflineKiloProbe(null);
    try { setOfflineKiloProbe(await window.studio.offlineKiloProbe(selected)); }
    catch { setOfflineKiloProbe({passed:false,reason:'sandbox-failed',stage:'prepare',detail:'other',exitCode:null}); }
    finally { setOfflineKiloChecking(false); }
  };

  const verifyOfflineReviewer = async (): Promise<void> => {
    if (!selected || offlineReviewerChecking) return;
    setOfflineReviewerChecking(true);
    setOfflineReviewerProbe(null);
    try { setOfflineReviewerProbe(await window.studio.offlineReviewerProbe(selected)); }
    catch { setOfflineReviewerProbe({passed:false,reason:'sandbox-failed',stage:null,detail:'other',exitCode:null}); }
    finally { setOfflineReviewerChecking(false); }
  };

  const verifyLocalModel = async (): Promise<void> => {
    if (!selected || localModelChecking) return;
    setLocalModelChecking(true);
    setLocalModelProbe(null);
    try { setLocalModelProbe(await window.studio.localModelProbe(selected)); }
    catch { setLocalModelProbe({passed:false,reason:'request-failed'}); }
    finally { setLocalModelChecking(false); }
  };

  const refreshKiloUsage = async (): Promise<void> => {
    if(!selected)return;
    try {
      setKiloUsage(await window.studio.kiloFreeUsage(selected));
      setKiloUsageError('');
    }catch{
      setKiloUsageError('Lokaler Kilo-Zähler nicht lesbar · Freigabe bleibt gesperrt');
    }
  };

  const updateLocalFallback = async (enabled:boolean):Promise<void> => {
    if(!selected||savingLocalFallback)return;
    setSavingLocalFallback(true);
    setPreviewError('');
    setRoutePreview(null);
    try{setLocalFallback(await window.studio.setLocalReviewFallback(selected,enabled));}
    catch{setPreviewError('Lokale Reviewer-Einstellung konnte nicht gespeichert werden');}
    finally{setSavingLocalFallback(false);}
  };

  const checkFreeRoutePreview = async ():Promise<void> => {
    if(!selected||previewLoading)return;
    setPreviewLoading(true);
    setPreviewError('');
    setRoutePreview(null);
    try{setRoutePreview(await window.studio.freeRoutePreview(selected));}
    catch{setPreviewError('Provider-Routing konnte nicht geprüft werden · keine Ausführung');}
    finally{setPreviewLoading(false);}
  };

  const checkFreeRunReadiness = async (): Promise<void> => {
    if(!selected||checkingReadiness)return;
    setCheckingReadiness(true);
    setReadiness(null);
    setReadinessError('');
    try{setReadiness(await window.studio.freeRunReadiness(selected));}
    catch{setReadinessError('Modell-/Kontingentprüfung fehlgeschlagen · keine Ausführung freigegeben');}
    finally{setCheckingReadiness(false);}
  };

  const calibrateKiloFreeReviewer = async (): Promise<void> => {
    if(!selected||!savedRoleModels||kiloCalibrating)return;
    setKiloCalibration(null);
    setKiloCalibrating(true);
    try{setKiloCalibration(await window.studio.kiloReviewerCalibrate(selected));}
    catch{setKiloCalibration({passed:false,reason:'transport-failed'});}
    finally{setKiloCalibrating(false);void refreshKiloUsage();}
  };

  const saveRoleModels = async (): Promise<void> => {
    if(!selected||savingRoleModels||!kiloModels)return;
    setSavingRoleModels(true);
    setRoleModelsMessage('');
    try {
      const saved=await window.studio.saveKiloRoleModels(selected,draftRoleModels);
      setSavedRoleModels(saved);
      setKiloCalibration(null);
      setReadiness(null);
      setRoleModelsMessage('Rollenzuordnung gespeichert · Ausführung weiterhin gesperrt');
    }catch{
      setRoleModelsMessage('Speichern abgelehnt: Kilo-Free-Katalog nicht erreichbar oder Modell nicht mehr kostenlos');
    }finally{setSavingRoleModels(false);}
  };

  const loadKiloModels = async (): Promise<void> => {
    if (!selected || kiloModelLoading) return;
    setKiloModelLoading(true);
    setKiloModelError('');
    setKiloModels(null);
    try {
      const catalog=await window.studio.kiloFreeModels(selected);
      setKiloModels(catalog);
      void refreshKiloUsage();
      const stored=await window.studio.kiloRoleModels(selected);
      setLocalFallback(await window.studio.localReviewFallback(selected));
      setRoutePreview(null);
      setSavedRoleModels(stored);
      const available=new Set(catalog.models.map(model=>model.id));
      const favorite=catalog.models.find(model=>model.preferred)?.id??catalog.models.find(model=>model.id==='kilo-auto/free')?.id??catalog.models[0]?.id??'';
      const pick=(id:string|undefined)=>id&&available.has(id)?id:favorite;
      setDraftRoleModels({planner:pick(stored?.planner),builder:pick(stored?.builder),reviewer:pick(stored?.reviewer)});
    }
    catch { setKiloModelError('Kilo-Modellkatalog derzeit nicht erreichbar · keine kostenpflichtigen Modelle übernommen'); }
    finally { setKiloModelLoading(false); }
  };

  const checkOllamaReadiness = async (): Promise<void> => {
    if (!selected || checkingOllama) return;
    setCheckingOllama(true);
    setOllamaReadiness(null);
    try { setOllamaReadiness(await window.studio.ollamaReadiness(selected)); }
    catch { setOllamaReadiness({ready:false,reason:'unreachable'}); }
    finally { setCheckingOllama(false); }
  };

  const verifyCalibration = async (): Promise<void> => {
    if (!selected || calibrating) return;
    setCalibrating(true);
    setCalibration(null);
    try { setCalibration(await window.studio.reviewerCalibration(selected)); }
    catch { setCalibration({passed:false,reason:'invalid-response'}); }
    finally { setCalibrating(false); }
  };

  const add = async (): Promise<void> => {
    try {
      setError('');
      const p = await window.studio.addProject();
      await refresh();
      if (p) { setSelected(p.id); setTab('overview'); }
    } catch (e) { setError(String(e)); }
  };

  const remove = async (): Promise<void> => {
    if (!selected || busy || !window.confirm('Projekt nur aus Studio entfernen? Dateien bleiben erhalten.')) return;
    try {
      setError('');
      await window.studio.removeProject(selected);
      setSelected('');
      await refresh();
    } catch (e) { setError(String(e)); }
  };

  const run = async (mode: RunMode): Promise<void> => {
    if (!selected || busy) return;
    try {
      setError('');
      if (mode === 'execute' && approval !== `EXECUTE ${project?.name ?? ''}`) {
        throw new Error('Projektfreigabe fehlt');
      }
      const token = mode === 'execute' ? approval : undefined;
      setEvents([]);
      setBusy(true);
      setTab('logs');
      await window.studio.start(selected, mode, token);
      if (mode === 'execute') { setConfirmOpen(false); setApproval(''); }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const viewHistoryLog = async (runId: string): Promise<void> => {
    if (!selected) return;
    setHistoryRun(runId);
    setSavedLog('Lade gespeichertes Protokoll …');
    try { setSavedLog(await window.studio.historyLog(selected, runId)); }
    catch (e) { setSavedLog(String(e)); }
  };

  const stop = async (): Promise<void> => {
    try { await window.studio.stop(); }
    catch (e) { setError(String(e)); }
  };

  const logs = <div className="console" role="log" aria-live="off">
    {events.length === 0
      ? <div className="empty">Noch keine Ausgabe. Starte eine Statusabfrage oder einen Dry-Run.</div>
      : events.map((event, index) => <div key={index} className={`entry ${event.type}`}>
        <time>{new Date(event.time).toLocaleTimeString('de-DE')}</time>
        <span>{event.type === 'start' ? `Start: ${event.mode} · ${event.project}`
          : event.type === 'exit' ? `Prozess beendet · Exit ${event.code ?? 'null'} · Signal ${event.signal ?? 'none'}`
            : event.message}</span>
      </div>)}
  </div>;

  return <div className="studio-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">A</div><div><strong>AutoDev <em>Studio</em></strong><small>Agentensteuerung für lokale Projekte</small></div></div>
      <div className="topbar-right"><span className="version">v0.2.3</span><span className={`status ${busy ? 'busy' : ''}`}>{busy ? 'Prozess läuft' : 'Bereit'}</span></div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-title"><span>PROJEKTE</span><button type="button" title="Projekt hinzufügen" onClick={() => void add()}>+</button></div>
        <div className="project-list">{projects.length === 0
          ? <p className="muted">Noch kein Projekt hinzugefügt.</p>
          : projects.map(p => <button type="button" key={p.id} className={`project ${selected === p.id ? 'selected' : ''}`} onClick={() => { setSelected(p.id); setTab('overview'); }}>
            <strong>{p.name}</strong><small>{p.path}</small><small className={p.hasCore ? 'core-ready' : 'core-missing'}>{p.hasCore ? 'Git-Projekt · Legacy-Controller' : 'Git-Projekt · Studio-Engine'}</small>
          </button>)}</div>
      </aside>

      <section className="content" ref={scrollScopeRef}>
        <div className="project-heading">
          <div className="project-identity"><h1>{project?.name ?? 'Projekt auswählen'}</h1><p title={project?.path}>{project?.path ?? 'Füge links ein Projekt hinzu.'}</p></div>
          <div className="heading-actions">{busy && <button className="danger" onClick={() => void stop()}>Prozess stoppen</button>}
            <button className="quiet" disabled={!selected || busy} onClick={() => void remove()}>Entfernen</button></div>
        </div>

        <nav className="tabs" aria-label="Arbeitsbereiche">
          <button className={tab === 'overview' ? 'active' : ''} aria-current={tab === 'overview' ? 'page' : undefined} onClick={() => setTab('overview')}>Übersicht</button>
          <button className={tab === 'agents' ? 'active' : ''} aria-current={tab === 'agents' ? 'page' : undefined} onClick={() => setTab('agents')}>Agenten</button>
          <button className={tab === 'logs' ? 'active' : ''} aria-current={tab === 'logs' ? 'page' : undefined} onClick={() => setTab('logs')}>Live-Protokoll {events.length > 0 ? <span className="count">{events.length}</span> : null}</button>
          <button className={tab === 'history' ? 'active' : ''} aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>Verlauf</button>
          <button className={tab === 'issues' ? 'active' : ''} aria-current={tab === 'issues' ? 'page' : undefined} onClick={() => { setTab('issues'); void loadIssues(); }}>Issues</button>
          <button className={tab === 'learning' ? 'active' : ''} aria-current={tab === 'learning' ? 'page' : undefined} onClick={() => setTab('learning')}>Lehrbuch</button>
        </nav>

        {tab === 'overview' && <div className="view overview">
          <div className="view-intro"><div><h2>Controller-Übersicht</h2><p>Zustand des ausgewählten Projekts · Aktualisierung alle 5 Sekunden</p></div></div>
          {project && !project.hasCore && (studioStatusError ? <div className="error" role="alert">Studio-Status nicht verfügbar: {studioStatusError}</div>
            : !studioStatus ? <div className="empty-state">Studio-Status wird geladen …</div>
              : <div className="studio-status-panel">
                  <div><small>Git-Branch</small><strong>{studioStatus.git.branch || 'Keiner'}</strong></div>
                  <div><small>Working Tree</small><strong>{studioStatus.git.clean ? 'Sauber' : 'Änderungen vorhanden'}</strong></div>
                  <div><small>Projektlock</small><strong>{studioStatus.lock.held ? 'Belegt' : 'Frei'}</strong></div>
                  <div><small>Checkpoint</small><strong>{studioStatus.checkpoint ? `#${studioStatus.checkpoint.issueNumber} · ${studioStatus.checkpoint.stage}` : 'Keiner'}</strong></div>
                  <p role="status">Wiederaufnahme: {studioStatus.recovery.state==='none'
                    ?'Keine Wiederaufnahme nötig – kein offener Studio-Checkpoint'
                    :studioStatus.recovery.reason}</p>
                  <p>Studio-Engine · {studioStatus.git.remoteSlug ?? 'Kein unterstütztes GitHub-Remote'} · Issue-Start nur nach GitHub-Schutzprüfung und freigegebener Triage; Status unter „Issues“ prüfen.</p>
                </div>)}
          {project?.hasCore && (snapshotError ? <div className="error" role="alert">{snapshotError}</div>
            : !selected ? <div className="empty-state">Wähle links ein Projekt aus.</div>
              : !snapshot ? <div className="empty-state">Lade Controller-Zustand …</div>
                : !snapshot.hasState ? <div className="empty-state">Für dieses Projekt existiert noch keine AutoDev-Zustandsdatei.</div>
                  : <>
                    <div className="metric-grid">
                      <div className="metric"><small>Aktuelles Issue</small><strong>{snapshot.currentIssue === null ? 'Keines' : `#${snapshot.currentIssue}`}</strong></div>
                      <div className="metric"><small>Phase</small><strong>{snapshot.checkpoint?.phase ?? 'Inaktiv'}</strong></div>
                      <div className="metric"><small>Abgeschlossen</small><strong>{snapshot.processedIssues.length}</strong></div>
                      <div className="metric"><small>Fehlgeschlagen</small><strong>{snapshot.failedIssues.length}</strong></div>
                    </div>
                    <div className="summary-line">{snapshot.checkpoint
                      ? <><span className="checkpoint-indicator">Checkpoint vorhanden</span> Issue #{snapshot.checkpoint.issueNumber} · {snapshot.checkpoint.phase} · {snapshot.checkpoint.reason}</>
                      : <><span className="good-indicator">● Kein offener Checkpoint</span> · Abgeschlossene Issues: {snapshot.processedIssues.join(', ') || 'Keine'}</>}</div>
                  </>)}
          {project?.hasCore && <div className="quick-actions"><div><h3>Sicher ausprobieren</h3><p>Diese Aktionen starten weder Builder noch Git-Push.</p></div><div className="button-group"><button disabled={!canRun || busy} onClick={() => void run('status')}>Status abrufen</button><button disabled={!canRun || busy} onClick={() => void run('dry-run')}>Dry-Run starten</button></div></div>}
        </div>}

        {tab === 'agents' && <div className="view agents">
          <div className="view-intro agent-intro"><h2>Agentensteuerung</h2><button type="button" className="quiet agent-info-trigger" onClick={() => setAgentInfoOpen(true)} aria-haspopup="dialog" aria-label="Informationen zu Studio-Controller und Prozessstopp">ⓘ Info</button></div>
          <div className="metric-grid three">
            <div className="metric"><small>Agent / Modus</small><strong>{busy ? (activeInfo?.mode === 'execute' ? 'Builder → Reviewer' : activeInfo?.mode ?? 'Aktiv') : 'Bereit'}</strong></div>
            <div className="metric"><small>Laufzeit</small><strong className="mono">{duration}</strong></div>
            <div className="metric"><small>Checkpoint</small><strong>{snapshot?.checkpoint ? `#${snapshot.checkpoint.issueNumber} · ${snapshot.checkpoint.phase}` : 'Keiner'}</strong></div>
          </div>
          <div className="provider-panel">
            <div className="provider-heading"><div><h3>Kilo · kostenlose Modelle</h3><p>Live-Katalog von Kilo, ausschließlich ausdrücklich kostenlose IDs. Nemotron 3 Ultra wird bevorzugt angezeigt; Verfügbarkeit wird jedes Mal neu geprüft.</p></div>
              <button disabled={!selected || kiloModelLoading} onClick={() => void loadKiloModels()}>{kiloModelLoading ? 'Lade Modelle …' : 'Free-Modelle laden'}</button></div>
            {kiloModelError && <p role="alert" className="error">{kiloModelError}</p>}
            {selected && <div className="sandbox-check">
              <button className="quiet" onClick={()=>void refreshKiloUsage()}>Kilo-Requests anzeigen</button>
              <span>{kiloUsageError || (kiloUsage ? <>
                <strong>{kiloUsage.usedLocal} von {kiloUsage.limit} lokal erfassten Gateway-Versuchen in den letzten 60 Minuten</strong>
                {' · '}Reserve: {kiloUsage.reserve}
                {kiloUsage.remainingVerified!==null ? ' · Anbieter bestätigt verbleibend: '+kiloUsage.remainingVerified :
                  ' · tatsächliches IP-Restkontingent unbekannt'}
                {kiloUsage.blockedBy429 ? ' · HTTP 429: weitere Kilo-Free-Requests gesperrt' : ''}
                {' · '}Andere Kilo-Clients und Geräte werden nicht mitgezählt.
              </> : 'Zählt nur direkte Modellanfragen aus AutoDev Studio; Kilo CLI und andere Apps sind nicht erfasst.')}</span>
            </div>}
            {kiloModels && <>
              <div className="provider-results" aria-label="Kostenlose Kilo-Modelle">
              {kiloModels.models.length===0 ? <p>Keine eindeutig kostenlosen Modelle gefunden. Aus Sicherheitsgründen wird nichts als kostenlos angenommen.</p> :
                kiloModels.models.map(model=><div key={model.id}><strong>{model.name}{model.preferred ? ' · Favorit' : ''}</strong><small className="mono">{model.id}</small></div>)}
              </div>
              <small className="catalog-updated">Stand: {new Date(kiloModels.checkedAt).toLocaleString('de-DE')} · Keine automatische Agentenfreigabe.</small>
              {kiloModels.models.length>0 && <section className="role-assignment-panel" aria-label="Modelle pro Rolle">
                <strong>Modelle pro Rolle</strong>
                <p>Die Free-Liste wird beim Speichern erneut geprüft. Diese Einstellung startet noch keine Agenten.</p>
                <div className="role-model-grid">
                  {(['planner','builder','reviewer'] as const).map(role=><label key={role} className="role-model-field">
                    <span>{role==='planner'?'Planner':role==='builder'?'Builder':'Reviewer'}</span>
                    <select aria-label={'Modell für '+role} value={draftRoleModels[role]}
                      onChange={e=>{setDraftRoleModels(v=>({...v,[role]:e.target.value}));setRoleModelsMessage('');}}>
                      {kiloModels.models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                  </label>)}
                </div>
                {savedRoleModels && <p className="role-saved-label">Gespeicherte Zuordnung geladen. Änderungen werden erst nach „Rollenzuordnung speichern“ übernommen.</p>}
                <div className="button-group"><button disabled={savingRoleModels||!draftRoleModels.planner||!draftRoleModels.builder||!draftRoleModels.reviewer}
                  onClick={()=>void saveRoleModels()}>{savingRoleModels?'Speichere …':'Rollenzuordnung speichern'}</button></div>
                {roleModelsMessage && <p role="status">{roleModelsMessage}</p>}
                {savedRoleModels && <div className="readiness-panel">
                  <label className="local-fallback-choice">
                    <input type="checkbox" checked={localFallback} disabled={savingLocalFallback}
                      onChange={e=>void updateLocalFallback(e.target.checked)}/>
                    <span>Lokalen Ollama-Reviewer als Fallback zulassen (nur Kandidat, keine automatische Ausführung)</span>
                  </label>
                  <div className="sandbox-check">
                    <button type="button" className="quiet" disabled={previewLoading||savingLocalFallback}
                      onClick={()=>void checkFreeRoutePreview()}>{previewLoading?'Prüfe Provider …':'Provider-Fallback simulieren'}</button>
                    <span>Nur Modellliste, lokaler Dienststatus und Quota · keine KI-Generierung</span>
                  </div>
                  {previewError && <p role="alert">{previewError}</p>}
                  {routePreview && <div role="status" className="readiness-steps">
                    {routePreview.roles.map(item=><div key={item.role}>
                      <strong>{item.role==='planner'?'Planner':item.role==='builder'?'Builder':'Reviewer'}</strong>
                      <span>{item.route==='ollama-candidate'?'Lokaler Reviewer wäre ein Fallback-Kandidat':
                        item.route==='kilo-candidate'?'Kilo-Free wäre ein Kandidat':
                        item.reason==='local-not-enabled'?'Lokaler Reviewer nicht freigegeben':
                        item.reason==='local-unavailable'?'Lokales Modell derzeit nicht erreichbar':
                        item.reason==='kilo-quota-exhausted'?'Kilo-Limit gesperrt':
                        item.reason==='kilo-quota-unverified'?'Kilo-Restkontingent unbekannt':
                        item.reason==='model-not-free'?'Modell fehlt im Free-Katalog':
                        item.reason==='reviewer-not-isolated'?'Kein unabhängig isolierter Reviewer':'Kein sicherer Provider vorhanden'}</span>
                    </div>)}
                    <small>Nur Simulation. Auch ein lokaler Kandidat muss kalibriert und technisch isoliert sein; echte Issue- und Git-Aktionen bleiben gesperrt.</small>
                  </div>}
                  <div className="sandbox-check">
                    <button type="button" className="quiet" disabled={checkingReadiness}
                      onClick={()=>void checkFreeRunReadiness()}>{checkingReadiness?'Prüfe Konfiguration …':'Modell-/Kontingentbereitschaft prüfen'}</button>
                    <span>Nur Free-Katalog und lokalen Zähler lesen · keine Modellanfragen, kein Git-Zugriff</span>
                  </div>
                  {readinessError && <p role="alert">{readinessError}</p>}
                  {readiness && <div role="status" className="readiness-steps">
                    {readiness.roles.map(item=><div key={item.role}>
                      <strong>{item.role==='planner'?'Planner':item.role==='builder'?'Builder':'Reviewer'}</strong>
                      <span>{item.reason==='ready'?'Modell und Quote geprüft':
                        item.reason==='remaining-unknown'?'Echte Kilo-Restquote nicht verfügbar':
                        item.reason==='reviewer-not-independent'?'Reviewer nutzt dasselbe Modell wie Builder':
                        item.reason==='model-no-longer-free'?'Modell nicht mehr als Free bestätigt':
                        item.reason==='429-blocked'?'Kilo-429-Sperre aktiv':
                        item.reason==='reserve-protected'?'5-%-Reserve geschützt':'Modell noch nicht konfiguriert'}</span>
                    </div>)}
                    <small>Produktive Ausführung weiterhin gesperrt. Eine positive Modellprüfung ersetzt weder Sandbox noch Quality Gates.</small>
                  </div>}
                </div>}
                {savedRoleModels && <div className="sandbox-check">
                  <button type="button" className="quiet" disabled={kiloCalibrating||kiloModelLoading}
                    onClick={()=>void calibrateKiloFreeReviewer()}>{kiloCalibrating?'Prüfe Kilo Reviewer …':'Kilo-Free-Reviewer kalibrieren'}</button>
                  <span>{kiloCalibration ? kiloCalibration.passed ?
                    'Kilo-Reviewer hat zwei synthetische PASS/FAIL-Fälle richtig erkannt · noch keine produktive Freigabe' :
                    kiloCalibration.reason==='rate-limit' ? 'Kilo-Free-Limit erreicht (HTTP 429) · sicher pausiert' :
                    kiloCalibration.reason==='quota-reserve' ? '5-%-Reserve erreicht oder paralleler Test · keine Modellanfrage' :
                    kiloCalibration.reason==='wrong-verdict' ? 'Reviewer hat einen synthetischen Fall falsch bewertet' :
                    kiloCalibration.reason==='model-unavailable' ? 'Reviewer-Modell ist nicht mehr kostenlos verfügbar oder nicht gespeichert' :
                    kiloCalibration.reason==='timeout' ? 'Kilo-Reviewer hat sein Zeitlimit erreicht' :
                    kiloCalibration.reason==='invalid-response' ? 'Kilo-Reviewer lieferte kein gültiges PASS/FAIL-JSON' :
                    'Kilo-Reviewer-Test fehlgeschlagen · keine Projektänderungen' :
                    'Zwei Free-Gateway-Anfragen nur mit künstlichen Codeänderungen · keine Projektdateien oder Zugangsdaten'}</span>
                </div>}
              </section>}
            </>}

            <div className="provider-heading"><div><h3>Lokale Provider</h3><p>Prüft nur Kilo CLI und GitHub-Anmeldung – keine Modellanfrage, keine Dateiänderungen.</p></div>
              <button disabled={!selected || checkingProviders} onClick={() => void checkProviders()}>{checkingProviders ? 'Prüfe …' : 'Umgebung prüfen'}</button></div>
            {diagnosticsError && <p className="error" role="alert">{diagnosticsError}</p>}
            {diagnostics && <div className="provider-results">
              <div><strong>Kilo CLI</strong><span>{diagnostics.kiloInstalled ? diagnostics.kiloVersion : 'Nicht gefunden'}</span><small>{diagnostics.kiloRunCommandReady ? 'CLI-Optionen erkannt' : 'CLI-Optionen unvollständig'} · {diagnostics.agentCatalogReadable ? 'Agentenliste abrufbar' : `Agentenliste: ${diagnostics.agentCatalogProblem === 'timeout' ? 'Zeitüberschreitung' : diagnostics.agentCatalogProblem === 'output-limit' ? 'Ausgabe zu groß' : diagnostics.agentCatalogProblem === 'not-found' ? 'Befehl fehlt' : diagnostics.agentCatalogProblem === 'empty-output' ? 'Leere Ausgabe' : 'CLI-Fehler'}`}</small><small>{diagnostics.sandboxTool ? `${diagnostics.sandboxTool}: ${diagnostics.sandboxToolAvailable ? 'Systemwerkzeug gefunden' : 'Nicht gefunden'}` : 'System-Sandbox: noch nicht unterstützt'} · Sandbox noch nicht validiert</small></div>
              <div><strong>GitHub CLI</strong><span>{diagnostics.ghInstalled ? 'Installiert' : 'Nicht gefunden'}</span><small>{diagnostics.ghAuthenticated ? 'GitHub-Anmeldung erkannt' : 'Keine gültige Anmeldung erkannt'}</small></div>
            </div>}
            <div className="sandbox-check"><button className="quiet" disabled={!selected || sandboxChecking || diagnostics?.sandboxTool !== 'bwrap' || !diagnostics.sandboxToolAvailable} onClick={() => void verifySandbox()}>{sandboxChecking ? 'Prüfe Sandbox …' : 'Sandbox testen'}</button><span>{sandboxError || (sandboxProbe ? sandboxProbe.isolated ? 'Schreibschutz und Start in Testumgebung bestätigt · Produktiv-Sandbox noch ausstehend' : `Sandbox-Test fehlgeschlagen: ${sandboxProbe.detail === 'namespace-permission-denied' ? 'User-Namespace nicht erlaubt' : sandboxProbe.detail === 'network-setup-denied' ? 'Netzwerk-Namespace blockiert' : sandboxProbe.detail === 'mount-setup-failed' ? 'Mount-Konfiguration fehlgeschlagen' : sandboxProbe.detail === 'timeout' ? 'Zeitüberschreitung' : sandboxProbe.detail === 'canary-read-failed' ? 'Testdatei innerhalb der Sandbox nicht lesbar' : sandboxProbe.detail === 'write-protection-failed' ? 'Schreibschutz nicht wirksam' : sandboxProbe.detail === 'canary-verification-failed' ? 'Testdatei nach Schreibversuch verändert' : sandboxProbe.detail === 'probe-command-failed' ? `Testbefehl fehlgeschlagen (Exit ${sandboxProbe.exitCode ?? '?'})` : 'Ursache unbekannt'}` : 'Separater Test ohne Kilo und ohne Projektänderungen')}</span></div>
            {sandboxProbe?.isolated && <div className="sandbox-check"><button className="quiet" disabled={!selected || reviewerChecking} onClick={() => void verifyReviewer()}>{reviewerChecking ? 'Prüfe Reviewer …' : 'Reviewer-Tool testen'}</button><span>{reviewerProbe ? reviewerProbe.passed ? 'Git-Prozess isoliert gestartet · Projekt weiterhin nur lesbar' : `Isolierter Git-Prozess fehlgeschlagen: ${reviewerProbe.detail === 'mountpoint-failed' ? 'Mount- oder Namespace-Konfiguration' : reviewerProbe.detail === 'runtime-library-missing' ? 'Laufzeitbibliothek fehlt' : reviewerProbe.detail === 'git-repository-rejected' ? 'Git-Repository in Sandbox nicht erkannt' : reviewerProbe.detail === 'git-command-failed' ? 'Git-Befehl fehlgeschlagen' : reviewerProbe.detail === 'timeout' ? 'Zeitüberschreitung' : 'Prozessstart fehlgeschlagen'}` : 'Prüft den tatsächlichen Git-Prozess in der Offline-Sandbox – ohne Modellaufruf'}</span></div>}
            {reviewerProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || qualityChecking} onClick={() => void verifyQualitySandbox()}>{qualityChecking ? 'Prüfe npm …' : 'Quality-Sandbox testen'}</button><span>{qualityProbe ? qualityProbe.passed ? 'npm in isolierter Testumgebung gestartet · keine Projektskripte ausgeführt' : qualityProbe.reason === 'npm-unavailable' ? 'System-npm unter /usr/bin/npm nicht gefunden' : qualityProbe.reason === 'invalid-output' ? 'npm-Version nicht erkannt' : `Quality-Sandbox: ${qualityProbe.stage === 'node' ? 'Node' : qualityProbe.stage === 'npm' ? 'npm' : 'Vorbereitung'} fehlgeschlagen${qualityProbe.detail ? ' · ' + (qualityProbe.detail === 'mount-or-namespace' ? 'Mount/Namespace' : qualityProbe.detail === 'runtime-library' ? 'Laufzeitdatei fehlt' : qualityProbe.detail === 'timeout' ? 'Zeitüberschreitung' : qualityProbe.detail === 'command-exit' ? 'Programmfehler' : 'Unbekannter Fehler') : ''}${qualityProbe.exitCode !== null ? ' (Exit ' + qualityProbe.exitCode + ')' : ''}` : 'Prüft ausschließlich npm --version in einem temporären Testverzeichnis'}</span></div>}
            {qualityProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || qualityScriptChecking} onClick={() => void verifyQualityScript()}>{qualityScriptChecking ? 'Prüfe Testskript …' : 'Quality-Skript testen'}</button><span>{qualityScriptProbe ? qualityScriptProbe.passed ? 'Testskript isoliert ausgeführt · Projektschreibzugriff erlaubt · .git geschützt' : qualityScriptProbe.reason === 'missing-expected-write' ? 'Testskript konnte nicht in das Testprojekt schreiben' : qualityScriptProbe.reason === 'git-metadata-modified' ? 'Git-Metadaten waren nicht ausreichend geschützt' : 'Isoliertes Testskript fehlgeschlagen' : 'Führt nur ein festes Testskript in einem temporären Projekt aus'}</span></div>}
            {qualityScriptProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || fullPipelineChecking} onClick={() => void verifyFullPipeline()}>{fullPipelineChecking ? 'Prüfe Workflow …' : 'Gesamtworkflow testen'}</button><span>{fullPipelineProbe ? fullPipelineProbe.passed ? 'Lokaler Trockenlauf erfolgreich · Git, Reviewer-Evidenz, Quality und Lock geprüft · keine Veröffentlichung' : fullPipelineProbe.reason === 'setup-failed' ? 'Temporäres Git-Testprojekt konnte nicht vorbereitet werden' : 'Lokaler Trockenlauf fehlgeschlagen · kein Projekt verändert' : 'Erzeugt ein Wegwerf-Git-Repository und testet die vollständige Schutzkette ohne KI und Push'}</span></div>}
            {fullPipelineProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || offlineKiloChecking} onClick={() => void verifyOfflineKilo()}>{offlineKiloChecking ? 'Prüfe Kilo …' : 'Kilo-Laufzeit testen'}</button><span>{offlineKiloProbe ? offlineKiloProbe.passed ? 'Kilo-Version und Run-Aufrufsyntax offline geprüft · keine Modellanfrage' : offlineKiloProbe.reason === 'cli-unavailable' ? 'Kilo weder im Studio-PATH noch in üblichen npm-Benutzerpfaden gefunden' : offlineKiloProbe.reason === 'cli-outside-usr' ? 'Kilo-Installationspfad nicht sicher freigebbar' : `Kilo: ${offlineKiloProbe.stage === 'version' ? 'Versionsprüfung' : offlineKiloProbe.stage === 'help' ? 'CLI-Hilfe' : 'Vorbereitung'} fehlgeschlagen${offlineKiloProbe.detail ? ' · ' + (offlineKiloProbe.detail === 'mount-or-namespace' ? 'Mount/Namespace' : offlineKiloProbe.detail === 'runtime-library' ? 'Laufzeitdatei fehlt' : offlineKiloProbe.detail === 'timeout' ? 'Zeitüberschreitung' : offlineKiloProbe.detail === 'process-exit' ? 'Programmfehler' : 'Unbekannter Fehler') : ''}${offlineKiloProbe.exitCode !== null ? ' (Exit ' + offlineKiloProbe.exitCode + ')' : ''}` : 'Startet ausschließlich kilo --version ohne Netzwerk, Zugangsdaten oder Projektzugriff'}</span></div>}
            {fullPipelineProbe?.passed && <div className="sandbox-check"><button className="quiet" disabled={!selected || offlineReviewerChecking} onClick={() => void verifyOfflineReviewer()}>{offlineReviewerChecking ? 'Prüfe Reviewer-Sandbox …' : 'Reviewer-Sandbox testen'}</button><span>{offlineReviewerProbe ? offlineReviewerProbe.passed ? 'Reviewer-CLI isoliert · keine Projektdateien, kein Netzwerk, keine Modellanfrage' : offlineReviewerProbe.reason === 'cli-unavailable' ? 'Kilo-Installation nicht gefunden' : offlineReviewerProbe.reason === 'invalid-output' ? 'Reviewer-CLI-Hilfe unvollständig' : `Reviewer-Sandbox: ${offlineReviewerProbe.stage === 'runtime' ? 'Kilo-Start' : offlineReviewerProbe.stage === 'help' ? 'CLI-Hilfe' : offlineReviewerProbe.stage === 'policy' ? 'Reviewer-Konfiguration' : 'Vorbereitung'} fehlgeschlagen${offlineReviewerProbe.detail ? ' · ' + (offlineReviewerProbe.detail === 'mount-or-namespace' ? 'Mount/Namespace' : offlineReviewerProbe.detail === 'runtime-library' ? 'Laufzeitdatei fehlt' : offlineReviewerProbe.detail === 'permission-or-config' ? 'Berechtigung/Konfiguration' : offlineReviewerProbe.detail === 'timeout' ? 'Zeitüberschreitung' : offlineReviewerProbe.detail === 'process-exit' ? 'Programmfehler' : 'Unbekannter Fehler') : ''}${offlineReviewerProbe.exitCode !== null ? ' (Exit ' + offlineReviewerProbe.exitCode + ')' : ''}` : 'Prüft die separate Werkzeug-Sperre ohne Anmeldung, KI- oder Projektzugriff'}</span></div>}
            {selected && <div className="sandbox-check"><button className="quiet" disabled={checkingOllama} onClick={() => void checkOllamaReadiness()}>{checkingOllama ? 'Prüfe Ollama …' : 'Ollama-Verbindung prüfen'}</button><span>{ollamaReadiness ? ollamaReadiness.ready ? 'Ollama erreichbar · qwen2.5-coder:3b installiert · keine Modellanfrage' : ollamaReadiness.reason === 'unreachable' ? 'Ollama auf 127.0.0.1:11434 nicht erreichbar' : ollamaReadiness.reason === 'model-missing' ? 'Ollama erreichbar, aber qwen2.5-coder:3b fehlt' : ollamaReadiness.reason === 'timeout' ? 'Ollama antwortet nicht innerhalb von 5 Sekunden' : ollamaReadiness.reason === 'http-error' ? 'Ollama antwortet mit HTTP-Fehler' : 'Ollama liefert eine ungültige Modellliste' : 'Fragt nur die lokale Modellliste ab · keine Generierung, keine Projektdateien'}</span></div>}
            {selected && <div className="sandbox-check"><button className="quiet" disabled={localModelChecking} onClick={() => void verifyLocalModel()}>{localModelChecking ? 'Prüfe lokales Modell …' : 'Lokales Review-Modell testen'}</button><span>{localModelProbe ? localModelProbe.passed ? 'Ollama-Modell antwortet strukturiert · nur synthetischer Diff · keine Projektdateien' : localModelProbe.reason === 'model-unavailable' ? 'Ollama oder qwen2.5-coder:3b nicht verfügbar' : localModelProbe.reason === 'invalid-verdict' ? 'Modellantwort entspricht noch nicht dem Reviewer-Format' : 'Lokaler Modelltest fehlgeschlagen · keine Projektänderung' : 'Einmaliger Test mit Qwen2.5-Coder 3B via localhost · keine Kilo-Tokens oder Projektdateien'}</span></div>}
            {selected && <div className="sandbox-check"><button className="quiet" disabled={calibrating} onClick={() => void verifyCalibration()}>{calibrating ? 'Kalibriere Reviewer …' : 'Reviewer kalibrieren (2 Modellanfragen)'}</button><span>{calibration ? calibration.passed ? 'Zwei künstliche Fälle korrekt als PASS und FAIL erkannt · keine Freigabe für echte Issues' : calibration.reason === 'wrong-verdict' ? 'Kalibrierung fehlgeschlagen: Modell hat mindestens einen Fall falsch bewertet' : calibration.reason === 'busy' ? 'Eine andere Kalibrierung läuft bereits' : calibration.reason === 'cancelled' ? 'Kalibrierung abgebrochen' : calibration.reason === 'timeout' ? 'Ollama-Zeitlimit erreicht (150 Sekunden pro Fall)' : calibration.reason === 'model-unavailable' ? 'Ollama hat die Modellanfrage abgelehnt (Modell fehlt oder Anfrage nicht unterstützt)' : calibration.reason === 'transport-failed' ? 'Ollama-Verbindung oder HTTP-Antwort fehlgeschlagen' : `Modellantwort nicht im geforderten Reviewer-JSON-Format${calibration.caseNumber ? ' (Testfall '+calibration.caseNumber+'/2)' : ''}` : 'Testet Qwen2.5-Coder 3B bewusst mit zwei künstlichen Codeänderungen via localhost; keine Projektdateien, keine Kilo-Tokens'}</span></div>}
          </div>
          {snapshot?.checkpoint && <div className="checkpoint-detail">Checkpoint: {snapshot.checkpoint.reason} · Session: {snapshot.checkpoint.sessionId ?? 'Fehlt – Core muss Wiederaufnahme verweigern'}</div>}
          {canRun && <div className="run-panel"><div><h3>Legacy-Agentenlauf</h3><p>Kann Dateien ändern, committen, pushen und Issues schließen. Erfordert eine ausdrückliche Freigabe.</p></div><button className="danger" disabled={busy} onClick={() => { setApproval(''); setConfirmOpen(true); }}>Ausführung vorbereiten</button></div>}
        </div>}

        {tab === 'logs' && <div className="view log-view">
          <div className="log-toolbar"><div><h2>Live-Protokoll</h2><p>{busy ? `Laufender Prozess · ${duration}` : 'Ausgabe des letzten Laufs in dieser Sitzung'}</p></div><button className="quiet" disabled={busy} onClick={() => setEvents([])}>Protokoll leeren</button></div>
          {logs}
        </div>}

        {tab === 'history' && <div className="view history-view">
          <div className="view-intro"><h2>Laufhistorie</h2><p>Auf diesem Gerät gespeicherte Läufe – auch nach einem Neustart verfügbar. Maximale Loggröße: 5 MB je Lauf.</p></div>
          {historyError && <div className="error" role="alert">{historyError}</div>}
          {history.length === 0 ? <div className="empty-state">Für dieses Projekt sind noch keine Läufe gespeichert.</div> :
            <div className="history-layout"><div className="history-list">{history.map(record =>
              <button key={record.runId} className={`history-item ${historyRun === record.runId ? 'selected' : ''}`} onClick={() => void viewHistoryLog(record.runId)}>
                <span className="history-top"><strong>{record.mode === 'execute' ? 'Agentenlauf' : record.mode === 'dry-run' ? 'Dry-Run' : 'Statusabfrage'}</strong><span className={`outcome ${record.outcome}`}>{record.outcome === 'success' ? 'Erfolgreich' : record.outcome === 'running' ? 'Läuft' : record.outcome === 'interrupted' ? 'Unterbrochen' : 'Fehlgeschlagen'}</span></span>
                <small>{new Date(record.startedAt).toLocaleString('de-DE')} · {record.endedAt ? `${Math.round((record.endedAt - record.startedAt) / 1000)} s` : 'Noch aktiv'}</small>
              </button>)}</div>
              <div className="history-detail"><div className="history-detail-head"><strong>{historyRun ? `Lauf ${historyRun.slice(0, 8)}` : 'Lauf auswählen'}</strong><span className="muted">Gespeichertes Protokoll</span></div><pre className="saved-log">{historyRun ? savedLog || 'Keine Ausgabe gespeichert.' : 'Wähle links einen Lauf aus, um sein Protokoll anzuzeigen.'}</pre></div>
            </div>}
        </div>}

        {tab === 'issues' && <div className="view issue-view">
          <div className="view-intro issue-title"><div><h2>GitHub-Issues</h2><p>Kilo ist primärer Planner, Builder und unabhängiger Reviewer: Issue → echter Code → isolierte Tests → Draft-PR. Ollama ist ausschließlich optionaler Fallback.</p></div>
            <button disabled={!selected || issuesLoading} onClick={() => void loadIssues()}>Aktualisieren</button></div>
          <div className="issue-label-onboarding">
            <button type="button"
              disabled={!selected||labelsInstalling||branchProtection?.protected!==true||Boolean(studioActivity?.busy)}
              onClick={()=>void installLabels()}>
              {labelsInstalling?'GitHub-Labels werden geprüft …':'Fehlende GitHub-Labels einrichten'}
            </button>
            <small>Nur für das ausgewählte Repository · bestehende Definitionen werden nicht geändert</small>
            {labelsResult&&<p role="status">{labelsResult}</p>}
            {labelsError&&<p role="alert">{labelsError}</p>}
          </div>
          <div role="status" className={branchProtection?.protected===true?'git-readiness ready':'git-readiness'}>
            <strong>{branchProtection?.protected===true?'Branch Protection verifiziert':
              branchProtection===null?'Branch Protection wird geprüft':'Entwicklung gesperrt · Branch Protection fehlt'}</strong>
            <span>{branchProtection?.protected===true
              ?branchProtection.evidence.repository+' · '+branchProtection.evidence.branch+
                ' · '+branchProtection.evidence.requiredChecks.length+' Pflichtchecks'
              :branchProtection?.protected===false?branchProtection.reason:
                'Keine Entwicklung, bis GitHub die Regeln bestätigt hat'}</span>
          </div>
          <section className={'issue-stack-readiness'+(stackProfile?.canDevelop?' issue-stack-readiness--ready':'')}
            role="status">
            <strong>{stackProfile?.canDevelop?'TechStack-Preflight bestanden':
              'TechStack-Preflight: Entwicklung nicht freigegeben'}</strong>
            {stackProfile && <p>{stackProfile.kind} · {stackProfile.packageManager??'kein bestätigter Package Manager'}
              · {stackProfile.qualityScripts.length} Pflichtprüfungen</p>}
            {stackProfile?.blockers.map((reason,i)=><p key={i}>Blocker: {reason}</p>)}
            {stackProfileError&&<p>Diagnose: {stackProfileError}</p>}
            {stackProfile && <details>
              <summary>Verifizierte Projektdateien und Toolversionen</summary>
              {stackProfile.evidence.map(item=><p key={item.file}>{item.file} · SHA256 {item.sha256.slice(0,12)}</p>)}
              {Object.entries(stackProfile.toolchain).map(([name,version])=>
                <p key={name}>{name}: {version}</p>)}
            </details>}
          </section>
          {studioStatus && (studioStatus.recovery.state!=='none'||studioStatus.lock.held) &&
            <section className="issue-safety-alert" role="alert" aria-label="Checkpoint-Sperre">
              <strong>⛔ CHECKPOINT / PROJEKTSPERRE</strong>
              <p>{studioStatus.checkpoint
                ?'Issue #'+studioStatus.checkpoint.issueNumber+' · Phase '+studioStatus.checkpoint.stage+
                  ' · Revision '+studioStatus.checkpoint.revision
                :'Projektlock vorhanden, aber kein gültiger Checkpoint sichtbar'}</p>
              <p><b>Warum gesperrt?</b> {studioStatus.recovery.reason}</p>
              <p><b>Nächster Schritt:</b> Laufprotokoll, Git-Branch und vorhandenen Draft-PR prüfen. Keine automatische Bereinigung, kein erneuter Push.</p>
              <button type="button" className="quiet" onClick={()=>void loadIssues()}>Diagnose aktualisieren</button>
            </section>}
          {issueQueue && !issueQueue.readyToStart && !studioStatus?.checkpoint && !studioStatus?.lock.held &&
            <section className="issue-safety-alert issue-safety-alert--waiting" role="status">
              <strong>ISSUE-WARTESCHLANGE NICHT STARTBEREIT</strong>
              <p>{issueQueue.reason==='No eligible open issues'
                ?'Kein offenes Issue besitzt derzeit alle erforderlichen Freigabe-Labels.'
                :issueQueue.reason==='Git repository is not a clean eligible starting point'
                  ?'Git-Branch oder Working Tree ist nicht für einen neuen Lauf geeignet.'
                  :issueQueue.reason}</p>
              <p>Prüfe Status und Priorität an den Issue-Karten. Eine manuelle Änderung ersetzt keine Checkpoint-Prüfung.</p>
            </section>}
          {gitError && <p className="muted">Git-Bereitschaft konnte nicht geprüft werden: {gitError}</p>}
          {issuesError && <div className="error" role="alert">{issuesError}</div>}
          {codeError && <div className="error" role="alert">{codeError}</div>}
          {verificationError && <div className="error" role="alert">{verificationError}</div>}
          {draftPrError && <div className="error" role="alert">{draftPrError}</div>}
          {studioActivity?.busy && <div className="git-readiness" role="status">
            <strong>Studio-Prozess belegt</strong>
            <span>{studioActivity.kind}{studioActivity.issueNumber!==null?' · Issue #'+studioActivity.issueNumber:''}
              {studioActivity.projectId!==selected?' · anderes Projekt':''}</span>
          </div>}
          {automationError && <div className="error" role="alert">{automationError}</div>}
          {automationResult && <div className="git-readiness" role="status">
            <strong>{automationResult.status==='draft-created'?'Draft-PR automatisch erstellt':'Automatisierung sicher pausiert'}</strong>
            <span>Issue #{automationResult.issueNumber} · Phase {automationResult.stage} · {automationResult.reason}</span>
            {automationResult.draftUrl && <a href={automationResult.draftUrl}
              target="_blank" rel="noopener noreferrer">Draft-PR auf GitHub öffnen</a>}
            {automationResult.learningReport && <small>
              Lehrbuchreport: {automationResult.learningReport==='saved'
                ?'automatisch im lokalen Lehrbuch gespeichert'
                :'nicht erstellt; Draft-PR ist trotzdem erfolgreich, bitte Lehrbuchdiagnose prüfen'}
            </small>}
            <small>Kein Auto-Merge. Ein unterbrochener Publish-Vorgang muss manuell geprüft werden.</small>
          </div>}
          {automatingIssue!==null && <div className="git-readiness" role="status">
            <strong>Issue #{automatingIssue}: automatisierter Ablauf …</strong>
            <span>{issueProgress?.projectId===selected && issueProgress.issueNumber===automatingIssue
              ?'Aktuelle Phase: '+({build:'Builder',review:'Unabhängiger Review',quality:'Quality-Gates',
                publish:'Draft-PR',done:'Abgeschlossen'} as const)[issueProgress.stage]
              :'Startvorbereitung · Branch Protection und Modellbereitschaft werden geprüft'}</span>
            <button type="button" className="quiet" onClick={()=>void window.studio.cancelIssueCode()}>Vor Publish abbrechen</button>
          </div>}
          {draftPr && <div className="git-readiness ready" role="status">
            <strong>Draft-Pull-Request für Issue #{draftPr.issueNumber} erstellt</strong>
            <span>{draftPr.branch} · <a href={draftPr.url} target="_blank" rel="noopener noreferrer">Pull Request auf GitHub öffnen</a></span>
            <small>Nur Draft. Kein Auto-Merge und kein automatisches Schließen des Issues.</small>
          </div>}
          {publishingIssue!==null && <div className="git-readiness" role="status">
            <strong>Draft-PR für Issue #{publishingIssue} wird erstellt …</strong>
            <span>Commit, Push und Draft-PR sind nicht unterbrechbar; beim Fehler bleibt ein nachvollziehbarer Checkpoint.</span>
          </div>}
          {verificationResult && <div className="git-readiness" role="status">
            <strong>{verificationResult.kind==='quality-passed'?'Review und Quality bestanden':
              verificationResult.kind==='review-failed'?'Reviewer verlangt Korrektur':'Quality-Gates fehlgeschlagen'}</strong>
            <span>Issue #{verificationResult.issueNumber} · Revision {verificationResult.checkpointRevision}
              {verificationResult.feedback?' · '+verificationResult.feedback:''}</span>
            <small>Kein Commit, Push oder PR. Die Veröffentlichung bleibt unabhängig vom Ergebnis gesperrt.</small>
          </div>}
          {verifyingIssue!==null && <div className="git-readiness" role="status">
            <strong>Issue #{verifyingIssue}: unabhängiger Review und Quality …</strong>
            <button type="button" className="quiet" onClick={()=>void window.studio.cancelIssueCode()}>Abbrechen</button>
          </div>}
          {codeResult && <div className="git-readiness ready" role="status">
            <strong>Issue #{codeResult.issueNumber} wurde zu echtem Code!</strong>
            <span>Branch: {codeResult.branch} · Änderung: {codeResult.changedFile} · Checkpoint: Review (Revision {codeResult.checkpointRevision})</span>
            <small>Kein Commit, kein Push und kein PR. Nächster Schritt: isolierter Review und Quality Gates.</small>
          </div>}
          {codingIssue!==null && <div className="git-readiness" role="status">
            <strong>Kilo Builder arbeitet an Issue #{codingIssue} …</strong>
            <span>Erst wird ein begrenzter Codevorschlag geprüft; anschließend wird ausschließlich auf einem neuen Issue-Branch geschrieben.</span>
            <button type="button" className="quiet" onClick={()=>void window.studio.cancelIssueCode()}>Abbrechen</button>
          </div>}
          {issuesLoading ? <div className="empty-state">Issues werden geladen …</div>
            : issues.length === 0 ? <div className="empty-state">Keine offenen Issues gefunden oder noch keine Abfrage ausgeführt.</div>
              : <div className="issue-list">{issues.map(issue => {
                const queued=issueQueue?.queue.find(item=>item.number===issue.number);
                const preview=issueStatusPreviews.find(item=>item.issueNumber===issue.number);
                const hold=explainIssueHold(issue.labels,queued?.reason,issue.body);
                const checkpointBlocked=Boolean(studioStatus?.lock.held)||
                  Boolean(studioStatus?.checkpoint &&
                    (studioStatus.checkpoint.issueNumber!==issue.number||
                      studioStatus.recovery.state==='manual'||
                      studioStatus.recovery.state==='locked'));
                return <article key={issue.number}
                  className={'issue-item'+(hold?.severity==='blocked'||checkpointBlocked?' issue-item--blocked':'')}>
                  <div className="issue-item-header">
                    <div className="issue-item-copy">
                      <div className="issue-item-heading"><span className="issue-number">#{issue.number}</span><h3>{issue.title}</h3></div>
                      {issue.labels.length > 0 && <p className="issue-labels">{issue.labels.join(' · ')}</p>}
                      {issue.body?.trim() && <p className="issue-description">{issue.body.trim().slice(0, 260)}{issue.body.trim().length > 260 ? ' …' : ''}</p>}
                    </div>
                    <a className="issue-external-link" href={issue.url} target="_blank" rel="noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a>
                  </div>
                  {preview && <section className="issue-status-preview" role="status">
                    <strong>Checkpoint → GitHub-Status (nur Vorschau)</strong>
                    <p>GitHub: {preview.current??'ungültig'} · aus belegtem Checkpoint:
                      {preview.proposed??' keine zulässige Ableitung'}</p>
                    <p>{preview.reason}</p>
                    <small>Keine automatischen Label-Änderungen. APPROVED und DONE benötigen zusätzliche externe Nachweise.</small>
                  </section>}
                  {queued && <details className="issue-triage-details">
                    <summary>Priorisierung: P{queued.priority} · {queued.state==='candidate'
                      ?'startfähig laut Labels':'zurückgestellt'} · Begründung</summary>
                    <p><strong>Quelle:</strong> GitHub-Labels (keine KI-Freigabe)</p>
                    {queued.triage?.evidence.map((line,i)=><p key={i}>{line}</p>)}
                    {queued.state==='held'&&<p role="status"><strong>Sperrgrund:</strong> {queued.reason}</p>}
                    <small>Nur eine Vorschau. Priorität und Freigabe müssen in GitHub
                      ausdrücklich gesetzt werden; Checkpoints und Branch Protection bleiben verbindlich.</small>
                  </details>}
                  {hold && <section className={'issue-hold-reason issue-hold-reason--'+hold.severity}
                    role={hold.severity==='blocked'?'alert':'status'}>
                    <strong>{hold.title}</strong>
                    <p><b>Warum?</b> {hold.why}</p>
                    <p><b>Nächster Schritt:</b> {hold.next}</p>
                  </section>}
                  <div className="issue-actions">
                    <button className="issue-primary-action" type="button"
                      disabled={Boolean(queued?.state==='held')||Boolean(hold)||Boolean(checkpointBlocked)||branchProtection?.protected!==true||automatingIssue!==null||codingIssue!==null||simulating!==null||verifyingIssue!==null||publishingIssue!==null}
                      onClick={()=>void automateIssue(issue.number)}>
                      {automatingIssue===issue.number?'Automatisiere …':'Issue → Draft-PR'}
                    </button>
                    {studioStatus?.checkpoint?.issueNumber===issue.number &&
                      studioStatus.checkpoint.stage==='quality' &&
                      studioStatus.checkpoint.reviewPassed &&
                      studioStatus.checkpoint.qualityPassed && <button type="button"
                      disabled={branchProtection?.protected!==true||publishingIssue!==null||verifyingIssue!==null||codingIssue!==null||simulating!==null||automatingIssue!==null}
                      onClick={()=>void createDraftPr(issue.number)}>
                      {publishingIssue===issue.number?'Draft-PR wird erstellt …':'Geprüften Draft-PR erstellen'}
                    </button>}
                    {studioStatus?.checkpoint?.issueNumber===issue.number &&
                      studioStatus.checkpoint.stage==='review' && <button type="button"
                      disabled={branchProtection?.protected!==true||verifyingIssue!==null||codingIssue!==null||simulating!==null||automatingIssue!==null}
                      onClick={()=>void verifyIssueCode(issue.number)}>
                      {verifyingIssue===issue.number?'Review läuft …':'Review + Tests'}
                    </button>}
                    <details className="issue-secondary-actions">
                      <summary>Weitere Aktionen</summary>
                      <div className="issue-secondary-buttons">
                        <button type="button" disabled={branchProtection?.protected!==true||automatingIssue!==null||codingIssue!==null||simulating!==null||verifyingIssue!==null||publishingIssue!==null}
                          onClick={()=>void convertIssueToCode(issue.number)}>
                          {codingIssue===issue.number?'Erzeuge Code …':'Nur Code erzeugen'}
                        </button>
                        <button type="button" disabled={simulating !== null||codingIssue!==null||verifyingIssue!==null||automatingIssue!==null}
                          onClick={() => void simulate(issue.number)}>
                          {simulating === issue.number ? 'Simuliere …' : 'Ablauf simulieren'}
                        </button>
                      </div>
                    </details>
                  </div>
                </article>;})}</div>}
          <div className="agent-footnote">Kilo plant, erstellt die Änderung und übergibt sie dem unabhängigen Reviewer und den Quality-Gates. Der Hauptlauf erstellt ausschließlich einen Draft-PR; kein automatischer Merge.</div>
        </div>}

        {tab === 'learning' && <div className="view issue-view learning-view">
          <div className="view-intro">
            <h2>Lehrbuch – Code wirklich verstehen</h2>
            <p>AutoDev liest den aktuellen Quellstand und erklärt mit lokalem Ollama oder optional Kilo Cloud
              Funktionen, Datenflüsse, Designentscheidungen, mögliche Alternativen und Tests.
              Die Git-Schnellanalyse bleibt als getrennte, einfachere Funktion verfügbar.</p>
          </div>
          <form className="learning-source-form" onSubmit={event=>{event.preventDefault();void inspectLearningHistory();}}>
            <label htmlFor="learning-repo">Öffentliches GitHub-Repository</label>
            <div className="learning-source-controls">
              <input id="learning-repo" value={learningInput} onChange={event=>{
                setLearningInput(event.target.value);setLearningHistory(null);setLearningBook(null);setLearningError('');
              }} placeholder="owner/repo oder https://github.com/owner/repo" autoComplete="off" />
              <button type="submit" disabled={learningLoading||!learningInput.trim()}>
                {learningLoading?'GitHub-Historie wird geprüft …':'Historie lesen'}
              </button>
            </div>
            <p>Nur lesen · Historienvorschau mit 20 Commits · die Buchanalyse verarbeitet weitere Seiten automatisch · kein Fremdcode wird ausgeführt</p>
          </form>
          {studioStatus?.git.remoteSlug && <button type="button" className="quiet"
            onClick={()=>void window.studio.loadLearningBook(studioStatus.git.remoteSlug!)
              .then(saved=>{
                if(saved){setLearningBook(saved);setLearningInput(saved.repository);
                  setLearningMessage('Gespeichertes Projekt-Lehrbuch geladen.');}
                else setLearningMessage('Für dieses Projekt wurde noch kein Lehrbuch gespeichert.');
              }).catch(()=>setLearningError('Projekt-Lehrbuch konnte nicht gelesen werden.'))}>
            Gespeichertes Projekt-Lehrbuch öffnen
          </button>}
          <button type="button" className="quiet"
            disabled={learningGenerating||!learningInput.trim()}
            onClick={()=>void window.studio.loadLearningBook(
              learningInput.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,''),
              learningProvider).then(saved=>{
                if(saved){
                  setLearningBook(saved);
                  setLearningMessage('Gesicherter Zwischenstand geöffnet; '+
                    'erneuter Analysestart setzt am letzten geprüften Kapitel fort.');
                }else setLearningMessage('Für diesen Anbieter noch kein Zwischenstand vorhanden.');
              }).catch(()=>setLearningError('Zwischenstand konnte nicht geladen werden.'))}>
            Gespeicherten Zwischenstand für dieses Repository öffnen
          </button>
          <div className="learning-provider-options" role="group" aria-label="KI-Anbieter für das Lehrbuch">
            <label><input type="radio" name="learning-provider" value="ollama"
              checked={learningProvider==='ollama'} disabled={learningGenerating}
              onChange={()=>{setLearningProvider('ollama');setLearningCloudConsent(false);}}/>
              Ollama – lokal, offline</label>
            <label><input type="radio" name="learning-provider" value="kilo"
              checked={learningProvider==='kilo'} disabled={learningGenerating}
              onChange={()=>{setLearningProvider('kilo');setLearningCloudConsent(false);}}/>
              Kilo Cloud – kostenloses Modell (Kontingent begrenzt)</label>
            {learningProvider==='kilo'&&<label className="learning-cloud-consent">
              <input type="checkbox" checked={learningCloudConsent} disabled={learningGenerating}
                onChange={event=>setLearningCloudConsent(event.target.checked)}/>
              Ich stimme ausdrücklich zu, dass AutoDev ausgewählte Quellcodeausschnitte
              und Git-Diffs zur Analyse an den Kilo-Cloud-Dienst überträgt.
              Kein Git-Schreibzugriff und keine Tool-Ausführung durch das Modell.
            </label>}
          </div>
          <div className="learning-source-controls">
            <button type="button" disabled={learningGenerating||!learningInput.trim()||
              (learningProvider==='kilo'&&!learningCloudConsent)}
              onClick={()=>void generateLearning()}>
              {learningGenerating?'Lehrbuch wird analysiert …':learningProvider==='kilo'
                ?'Lehrbuch mit Kilo Cloud analysieren':'Lehrbuch mit Ollama analysieren'}
            </button>
            <button type="button" className="quiet" disabled={learningGenerating||!learningInput.trim()}
              onClick={()=>void quickLearning()}>Git-Schnellüberblick (ohne Modell)</button>
            {learningBook&&<span role="status">{learningBook.deepAnalysis
              ?learningBook.deepAnalysis.filesAnalyzed+' Quelldateien'
              :learningBook.lessons+' Themen'} · Stand {learningBook.head.slice(0,12)}</span>}
          </div>
          {learningMessage&&<p role="status">{learningMessage}</p>}
          {learningBook&&<section className="learning-results" aria-label="Lehrbuch lesen und exportieren">
            <h3>Dein Lehrbuch – {learningBook.repository}</h3>
            <p>{learningBook.deepAnalysis
              ?'Codeanalyse mit '+learningBook.deepAnalysis.model+
                '. Analysierte Dateien: '+learningBook.deepAnalysis.filesAnalyzed+
                ', ausgelassen: '+learningBook.deepAnalysis.filesSkipped+
                '. Hypothetische Entwicklungsgründe bleiben als Interpretation gekennzeichnet.'
              :'Automatische Git- und Konzeptübersicht ohne vollständige Modellanalyse.'}</p>
            {learningBook.deepAnalysis&&!learningBook.deepAnalysis.complete&&
              <p role="alert">Codeanalyse mit Einschränkungen: {learningBook.deepAnalysis.filesSkipped}
                Dateien wurden aus Sicherheits-, Format- oder Größengründen ausgelassen.
                Das Buch behauptet keine vollständige Abdeckung.</p>}
            <div className="learning-export-actions">
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('book','pdf')}>Lehrbuch als PDF</button>
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('book','md')}>Markdown</button>
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('solutions','pdf')}>Lösungen als PDF</button>
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('solutions','md')}>Lösungen als MD</button>
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('reports','md')}>Entwicklungsreports als MD</button>
              <button type="button" disabled={learningExporting} onClick={()=>void exportLearning('reports','pdf')}>Entwicklungsreports als PDF</button>
              {learningBook.hasMore&&<button type="button"
                disabled={learningGenerating||learningExporting} onClick={()=>void growLearning()}>
                Historienanalyse fortsetzen
              </button>}
            </div>
            <details><summary>Lehrbuch-Inhalt anzeigen</summary>
              <pre className="learning-preview">{learningBook.bookMarkdown}</pre>
            </details>
          </section>}
          {learningError && <div className="error" role="alert">{learningError}</div>}
          {learningHistory && <section className="learning-results" aria-label="Historische Commit-Analyse">
            <h3>{learningHistory.repository}</h3>
            <p>Default-Branch: <strong>{learningHistory.defaultBranch}</strong> ·
              Fester HEAD: <code>{learningHistory.fixedHead.slice(0,12)}</code> ·
              Lizenz: <strong>{learningHistory.licenseSpdx??'Unbekannt – Lizenz vor Übernahme prüfen'}</strong></p>
            <div className="git-readiness" role="status">
              <strong>Quellenindex, noch kein fertiges Lehrbuch</strong>
              <span>Die Commits sind Belege für Änderungen. Entwicklungsabsichten und technische Qualität
                lassen sich daraus nicht ohne zusätzliche Prüfung ableiten.</span>
            </div>
            <div className="learning-commit-list">{learningHistory.commits.map(commit=>
              <article className="learning-commit" key={commit.sha}>
                <div className="learning-commit-heading">
                  <strong>{commit.title}</strong>
                  <a href={commit.evidenceUrl} target="_blank" rel="noopener noreferrer">Commit {commit.sha.slice(0,10)}</a>
                </div>
                <small>{commit.committedAt
                  ?new Date(commit.committedAt).toLocaleDateString('de-DE'):'Datum unbekannt'}</small>
                <p>{commit.changedPaths.length>0?commit.changedPaths.join(' · '):
                  'Dateipfade nicht verfügbar'}</p>
                {!commit.pathsComplete && <small>Änderungsliste eventuell unvollständig</small>}
              </article>)}</div>
            <p>Aus diesem Quellenindex entstehen später geprüfte Themenkapitel mit Übungen,
              getrennten Lösungen und PDF-Export. Das Original-Repository bleibt unverändert.</p>
          </section>}
        </div>}

        <ScrollJumpControls scopeRef={scrollScopeRef} refreshKey={`${tab}:${selected}`} />
        {error && <div className="error floating-error" role="alert">{error}<button onClick={() => setError('')}>Schließen</button></div>}
      </section>
    </div>

    {learningModalOpen && <div className="modal-backdrop">
      <div className="modal learning-progress-modal" role="dialog" aria-modal="true"
        aria-labelledby="learning-progress-title">
        <div className="agent-info-header">
          <h2 id="learning-progress-title">Code-Lehrbuch · {learningProvider==='kilo'?'Kilo Cloud':'lokales Ollama'}</h2>
          {!learningGenerating&&<button type="button" className="quiet"
            onClick={()=>setLearningModalOpen(false)}>Schließen</button>}
        </div>
        <p><strong>{learningModalError?'Fehlgeschlagen':learningGenerating
          ?'Analyse läuft':'Analyse abgeschlossen'}</strong> ·
          {' '+(learningProgress?.repository??learningInput)}</p>
        <p role="status">{learningProgress?.current??'GitHub-Historie wird geprüft …'}</p>
        <div className="learning-progress-track" role="progressbar"
          aria-label="Analysefortschritt" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={learningProgress?.total
            ?Math.round(100*learningProgress.completed/learningProgress.total):0}>
          <div style={{width:(learningProgress?.total
            ?Math.round(100*learningProgress.completed/learningProgress.total):0)+'%'}}/>
        </div>
        <p>Schritt {learningProgress?.completed??0} von {learningProgress?.total||'?'} ·
          Laufzeit: <time className="mono" aria-label="Laufzeit in Stunden Minuten Sekunden">{formatLearningDuration(Math.max(0,(clock-(learningProgress?.startedAt??learningStartedAt))/1000))}</time> ·
          ETA: <time className="mono" aria-label="Verbleibende Zeit in Stunden Minuten Sekunden">{formatRemainingEta(learningProgress?.etaSeconds,learningEtaReceivedAt,clock)}</time></p>
        <p>Modell: {learningProgress?.model??(learningProvider==='kilo'?'kilo-auto/free':'qwen2.5-coder:3b')} ·
          {learningProvider==='kilo'
            ?' Kilo Cloud · Quellcode wird extern verarbeitet · Freikontingent nicht garantiert'
            :' lokal auf 127.0.0.1 · keine externen KI-Tokens'}</p>
        {learningProgress?.preview&&<section className="learning-progress-preview"
          aria-label="Live-Vorschau der letzten Lektion">
          <strong>Live-Vorschau</strong>
          <pre>{learningProgress.preview}</pre>
        </section>}
        {learningModalError&&<p role="alert">{learningModalError}</p>}
        {learningGenerating&&<button type="button" className="quiet"
          onClick={()=>void window.studio.cancelDeepLearning()}>
          Analyse abbrechen
        </button>}
        {!learningGenerating&&!learningModalError&&<p role="status">
          Verarbeitung abgeschlossen. {learningBook?.deepAnalysis&&!learningBook.deepAnalysis.complete
            ?'Einige Dateien wurden ausgeschlossen; die Abdeckung wird im Buch ausgewiesen. '
            :''}Das Markdown ist lokal gespeichert und kann als PDF exportiert werden.
        </p>}
      </div>
    </div>}
    {agentInfoOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAgentInfoOpen(false); }}>
      <div className="modal agent-info-modal" role="dialog" aria-modal="true" aria-labelledby="agent-info-title" onKeyDown={event => { if (event.key === 'Escape') setAgentInfoOpen(false); }}>
        <div className="agent-info-header"><h2 id="agent-info-title">Hinweise zur Agentensteuerung</h2><button type="button" className="quiet" onClick={() => setAgentInfoOpen(false)}>Schließen</button></div>
        <h3>Studio-Controller</h3>
        <p>Der neue Studio-Controller ist für alle Git-Projekte vorgesehen. Produktive Agentenläufe bleiben bis zur sicheren Migration des Legacy-Controllers deaktiviert.</p>
        <h3>Stopp und Wiederaufnahme</h3>
        <p>Ein Stopp sendet SIGTERM und erforderlichenfalls SIGKILL. Er ist keine garantierte Checkpoint-Pause. Der Core prüft Wiederaufnahme und Doppelstarts.</p>
        <p>Bestehende produktive Läufe verwenden vorübergehend den LaceFrame-Legacy-Controller. Der unabhängige Studio-Workflow ist bereits separat testbar.</p>
      </div>
    </div>}
    {simulation && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSimulation(null); }}>
      <div className="modal simulation-modal" role="dialog" aria-modal="true" aria-labelledby="simulation-title">
        <div className="simulation-heading"><div><h2 id="simulation-title">Simulation · Issue #{simulation.state.issueNumber}</h2>
          <p>Ergebnis: {simulation.state.stage} · Korrekturrunden: {simulation.state.fixAttempts}</p></div>
          <button className="quiet" onClick={() => setSimulation(null)}>Schließen</button>
        </div>
        <div className="simulation-scroll">
          <div className="simulation-trace"><ol>{simulation.events.map((event, index) => <li key={index}><strong>{event.stage}</strong> – {event.message}</li>)}</ol></div>
          <p className="muted">Nur Simulation: keine Dateiänderungen, Modellaufrufe, Git-Commits oder GitHub-Mutationen.</p>
        </div>
      </div>
    </div>}
    {confirmOpen && project && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setConfirmOpen(false); setApproval(''); } }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-icon">!</div><h2 id="confirm-title">Produktiven Lauf freigeben?</h2>
        <p>AutoDev kann im Projekt <strong>{project.name}</strong> Code verändern, Tests ausführen, Commits erstellen, nach GitHub pushen und Issues schließen.</p>
        <p>Wiederaufnahme und vorhandene Checkpoints prüft der AutoDev Core. Eine Freigabe gilt nur für diesen Start.</p>
        <label htmlFor="approve-text">Zur Bestätigung exakt <code>EXECUTE {project.name}</code> eingeben:</label>
        <input id="approve-text" autoFocus autoComplete="off" spellCheck={false} value={approval} onChange={event => setApproval(event.target.value)} placeholder={`EXECUTE ${project.name}`} />
        <div className="modal-actions"><button className="quiet" onClick={() => { setConfirmOpen(false); setApproval(''); }}>Abbrechen</button><button className="danger" disabled={busy || approval !== `EXECUTE ${project.name}`} onClick={() => void run('execute')}>Produktiven Lauf starten</button></div>
      </div>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
