import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Shield, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Terminal, 
  BarChart3, 
  Plus, 
  ArrowRight,
  Zap,
  Cpu,
  History
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { WorkflowState, AgentDecision } from './services/agentService';

const MOCK_PREDICTION_DATA = [
  { time: '08:00', risk: 12 },
  { time: '10:00', risk: 15 },
  { time: '12:00', risk: 45 },
  { time: '14:00', risk: 32 },
  { time: '16:00', risk: 28 },
  { time: '18:00', risk: 18 },
];

export default function App() {
  const [workflows, setWorkflows] = useState<WorkflowState[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [interrogating, setInterrogating] = useState<{decision: AgentDecision, agent: string} | null>(null);
  const [interrogationQuery, setInterrogationQuery] = useState('');
  const [interrogationResponse, setInterrogationResponse] = useState('');
  const [chaosMode, setChaosMode] = useState(false);
  const [systemPulse, setSystemPulse] = useState<string[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [predictionData, setPredictionData] = useState(MOCK_PREDICTION_DATA);

  const addPulse = async (msg: string, skipApi = false) => {
    const timestampedMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
    setSystemPulse(prev => [...prev.slice(-19), timestampedMsg]);
    
    if (!skipApi) {
      try {
        await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: timestampedMsg })
        });
      } catch (e) {
        console.error("Failed to persist log:", e);
      }
    }
  };

  useEffect(() => {
    if (activeWorkflow) {
      // Generate some dynamic points around the risk score
      const base = activeWorkflow.riskScore;
      const newData = Array.from({ length: 6 }, (_, i) => ({
        time: `${8 + i * 2}:00`,
        risk: Math.max(0, Math.min(100, base + (Math.random() * 20 - 10)))
      }));
      setPredictionData(newData);
    }
  }, [activeWorkflow?.id, activeWorkflow?.riskScore]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    
    socket.onopen = () => {
      addPulse("SYSTEM: WebSocket connection established.");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'INIT') {
        setWorkflows(data.workflows);
        if (data.logs) {
          setSystemPulse(data.logs.map((l: any) => l.message).slice(-20));
        }
      } else if (data.type === 'WORKFLOW_UPDATE') {
        setWorkflows(prev => {
          const index = prev.findIndex(w => w.id === data.workflow.id);
          if (index !== -1) {
            const next = [...prev];
            next[index] = data.workflow;
            return next;
          }
          return [data.workflow, ...prev];
        });
        
        setActiveWorkflow(prev => {
          if (prev?.id === data.workflow.id) return data.workflow;
          return prev;
        });
      } else if (data.type === 'SYSTEM_PULSE') {
        addPulse(data.log.message);
      }
    };

    socket.onclose = () => {
      addPulse("SYSTEM: WebSocket connection closed.");
    };

    setWs(socket);
    return () => socket.close();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const res = await fetch('/api/workflows');
      const data = await res.json();
      setWorkflows(data);
    } catch (e) {
      console.error("Failed to fetch workflows:", e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSystemPulse(data.map((l: any) => l.message).slice(-20));
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    }
  };

  useEffect(() => {
    fetchWorkflows();
    fetchLogs();
  }, []);

  const handleRunAgent = async (existingWorkflow?: WorkflowState) => {
    if (!taskInput && !existingWorkflow) return;
    setLoading(true);
    try {
      const msg = `Orchestrator: Initializing task "${existingWorkflow ? existingWorkflow.task : taskInput}"`;
      await addPulse(msg);
      
      if (chaosMode) {
        const chaosMsg = "CHAOS MODE: Injecting network latency and jitter...";
        await addPulse(chaosMsg);
      }
      
      const { runOrchestrator } = await import('./services/agentService');
      
      const onUpdate = async (updatedState: any) => {
        // Broadcast via WS
        ws?.send(JSON.stringify({ type: 'WORKFLOW_UPDATE', workflow: updatedState }));
        
        // Save to backend
        await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedState)
        });

        setWorkflows(prev => {
          const index = prev.findIndex(w => w.id === updatedState.id);
          if (index !== -1) {
            const next = [...prev];
            next[index] = updatedState;
            return next;
          }
          return [updatedState, ...prev];
        });
        
        setActiveWorkflow(prev => {
          // If we're currently running this workflow, or if no workflow is selected, update it
          if (!prev || prev.id === updatedState.id) {
            return updatedState;
          }
          return prev;
        });
      };

      const data = await runOrchestrator(
        existingWorkflow ? existingWorkflow.task : taskInput, 
        existingWorkflow,
        onUpdate,
        chaosMode
      );
      
      const statusMsg = `Workflow ${data.id}: Final status ${data.status}`;
      await addPulse(statusMsg);
      
      setTaskInput('');
    } catch (err: any) {
      console.error(err);
      const errMsg = `ERROR: ${err?.message || 'Unknown error during execution'}`;
      await addPulse(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleInterrogate = async () => {
    if (!interrogating || !interrogationQuery) return;
    setLoading(true);
    try {
      const { interrogateAgent } = await import('./services/agentService');
      const res = await interrogateAgent(interrogating.agent, interrogating.decision, interrogationQuery);
      setInterrogationResponse(res);
      addPulse(`Interrogation: ${interrogating.agent} responded to query.`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-600 rounded flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">NEXUS <span className="text-white/40 font-normal">Autonomous Orchestrator</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-[11px] font-medium text-green-500 uppercase tracking-wider">System Operational</span>
            </div>
            <div className="h-4 w-[1px] bg-white/10" />
            <button className="text-white/60 hover:text-white transition-colors">
              <History className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8 grid grid-cols-12 gap-6">
        {/* Left Column: Controls & Stats */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* New Task Card */}
          <div className="bg-[#151518] border border-white/5 rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium text-white/60 uppercase tracking-widest flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Workflow
              </h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Chaos Mode</span>
                <button 
                  onClick={() => {
                    const nextChaos = !chaosMode;
                    setChaosMode(nextChaos);
                    if (activeWorkflow) {
                      setActiveWorkflow(prev => prev ? { ...prev, chaosMode: nextChaos } : null);
                      addPulse(`SYSTEM: Chaos Mode ${nextChaos ? 'ENABLED' : 'DISABLED'} for active workflow.`);
                    }
                  }}
                  className={cn(
                    "w-10 h-5 rounded-full transition-all relative",
                    chaosMode ? "bg-orange-600" : "bg-white/10"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    chaosMode ? "left-6" : "left-1"
                  )} />
                </button>
              </div>
              <textarea 
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder="Describe enterprise task (e.g. Procure 500 laptops with risk assessment)..."
                className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-4 text-sm focus:outline-none focus:border-orange-500/50 transition-all resize-none placeholder:text-white/20"
              />
              <button 
                onClick={() => handleRunAgent()}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-all group"
              >
                {loading ? (
                  <Zap className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Initialize Autonomous Agents
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Prediction Chart */}
          <div className="bg-[#151518] border border-white/5 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium text-white/60 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Risk Prediction
              </h2>
              <span className="text-[10px] bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded border border-orange-500/20">Real-time</span>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={predictionData}>
                  <defs>
                    <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={activeWorkflow?.riskScore && activeWorkflow.riskScore > 75 ? "#ef4444" : "#f97316"} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={activeWorkflow?.riskScore && activeWorkflow.riskScore > 75 ? "#ef4444" : "#f97316"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff20" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#ffffff20" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#151518', border: '1px solid #ffffff10', fontSize: '12px' }}
                    itemStyle={{ color: activeWorkflow?.riskScore && activeWorkflow.riskScore > 75 ? "#ef4444" : "#f97316" }}
                  />
                  <Area type="monotone" dataKey="risk" stroke={activeWorkflow?.riskScore && activeWorkflow.riskScore > 75 ? "#ef4444" : "#f97316"} fillOpacity={1} fill="url(#colorRisk)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-4 text-[11px] text-white/40 leading-relaxed italic">
              * Predictive engine identifies potential SLA bottlenecks based on current agent workload and historical latency.
            </p>
          </div>

          {/* Live Pulse Terminal */}
          <div className="bg-black border border-white/5 rounded-xl p-4 font-mono text-[10px]">
            <div className="flex items-center gap-2 mb-3 text-white/40 uppercase tracking-[0.2em] font-bold">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Live System Pulse
            </div>
            <div className="space-y-1 h-32 overflow-y-auto custom-scrollbar">
              {systemPulse.map((p, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "text-[10px] font-mono",
                    p.includes('CHAOS') ? "text-orange-500" : 
                    p.includes('ERROR') ? "text-red-500" :
                    "text-white/60"
                  )}
                >
                  {p}
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Active Workflow & Audit Trail */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {activeWorkflow ? (
            <AnimatePresence mode="wait">
              <motion.div 
                key={activeWorkflow.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Workflow Status Header */}
                <div className="bg-[#151518] border border-white/5 rounded-xl p-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-tight">Workflow {activeWorkflow.id}</h2>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border",
                          activeWorkflow.status === 'COMPLETED' ? "bg-green-500/10 text-green-500 border-green-500/20" : 
                          activeWorkflow.status === 'PENDING_APPROVAL' ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20 animate-pulse" :
                          "bg-orange-500/10 text-orange-500 border-orange-500/20"
                        )}>
                          {activeWorkflow.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-white/40 text-sm">Autonomous Execution Path: {activeWorkflow.type}</p>
                    </div>
                    <div className="text-right space-y-1">
                      <div className="text-[10px] text-white/40 uppercase tracking-widest">Risk Analysis</div>
                      <div className={cn(
                        "text-3xl font-mono font-bold",
                        activeWorkflow.riskScore > 50 ? "text-red-500" : "text-green-500"
                      )}>
                        {activeWorkflow.riskScore}%
                      </div>
                    </div>
                  </div>

                  {(activeWorkflow.status === 'PENDING_APPROVAL' || activeWorkflow.status === 'FAILED') && (
                    <div className={cn(
                      "p-6 rounded-lg flex items-center justify-between gap-6",
                      activeWorkflow.status === 'FAILED' ? "bg-red-500/5 border border-red-500/20" : "bg-yellow-500/5 border border-yellow-500/20"
                    )}>
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center",
                          activeWorkflow.status === 'FAILED' ? "bg-red-500/10" : "bg-yellow-500/10"
                        )}>
                          {activeWorkflow.status === 'FAILED' ? (
                            <AlertCircle className="w-6 h-6 text-red-500" />
                          ) : (
                            <AlertCircle className="w-6 h-6 text-yellow-500" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <h4 className={cn(
                            "text-sm font-bold uppercase tracking-wider",
                            activeWorkflow.status === 'FAILED' ? "text-red-500" : "text-yellow-500"
                          )}>
                            {activeWorkflow.status === 'FAILED' ? "Critical Execution Failure" : "Human Intervention Required"}
                          </h4>
                          <p className="text-xs text-white/60 leading-relaxed">
                            {activeWorkflow.status === 'FAILED' 
                              ? "The workflow has terminated after multiple failed recovery attempts. You can attempt to retry the current step or investigate the audit trail."
                              : (activeWorkflow.approvalReason || "The orchestrator has paused execution due to high risk or value. Please review the audit trail and authorize the next step.")
                            }
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleRunAgent(activeWorkflow)}
                        disabled={loading}
                        className={cn(
                          "font-bold px-6 py-2 rounded-lg text-sm transition-all flex items-center gap-2",
                          activeWorkflow.status === 'FAILED' 
                            ? "bg-red-600 hover:bg-red-500 text-white" 
                            : "bg-yellow-500 hover:bg-yellow-400 text-black"
                        )}
                      >
                        {loading ? <Zap className="w-4 h-4 animate-spin" /> : (
                          <>
                            {activeWorkflow.status === 'FAILED' ? <History className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                            {activeWorkflow.status === 'FAILED' ? "Retry Execution" : "Authorize Execution"}
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Agent Network Visualization */}
                  <div className="pt-6 border-t border-white/5">
                    <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] mb-4">Active Agent Network</div>
                    <div className="flex items-center justify-between px-4">
                      {[
                        { name: 'Orchestrator', icon: Cpu, color: 'text-blue-500' },
                        { name: 'Risk Analyst', icon: Shield, color: 'text-purple-500' },
                        { name: 'Executor', icon: Zap, color: 'text-orange-500' },
                        { name: 'Auditor', icon: CheckCircle2, color: 'text-green-500' }
                      ].map((agent, i, arr) => (
                        <React.Fragment key={agent.name}>
                          <div className="flex flex-col items-center gap-2">
                            <div className={cn(
                              "w-10 h-10 rounded-full border border-white/10 flex items-center justify-center bg-black/40",
                              activeWorkflow.decisions.some(d => d.agent === agent.name) ? "border-white/40 ring-2 ring-white/5" : "opacity-30"
                            )}>
                              <agent.icon className={cn("w-5 h-5", agent.color)} />
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-tighter text-white/40">{agent.name}</span>
                          </div>
                          {i < arr.length - 1 && (
                            <div className="flex-1 h-[1px] bg-white/5 mx-2 relative">
                              {activeWorkflow.decisions.some(d => d.agent === arr[i+1].name) && (
                                <motion.div 
                                  initial={{ left: 0 }}
                                  animate={{ left: '100%' }}
                                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                  className="absolute top-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full shadow-[0_0_8px_white]"
                                />
                              )}
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Audit Trail (Recipe 1: Data Grid) */}
                <div className="bg-[#151518] border border-white/5 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <h2 className="text-xs font-semibold text-white/60 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Terminal className="w-4 h-4" /> Immutable Audit Trail
                    </h2>
                  </div>
                  {/* Execution Progress */}
              {activeWorkflow.plan && activeWorkflow.plan.length > 0 && (
                <div className="mb-8 p-6 bg-black/40 border border-white/10 rounded-xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="space-y-1">
                      <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-white/40">Execution Protocol</h3>
                      <div className="text-[10px] text-cyan-400 font-mono">
                        STEP {activeWorkflow.currentStepIndex + 1} OF {activeWorkflow.plan.length}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {activeWorkflow.plan.map((_, i) => (
                        <div 
                          key={i} 
                          className={cn(
                            "w-8 h-1 rounded-full transition-all duration-500",
                            i < activeWorkflow.currentStepIndex ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" :
                            i === activeWorkflow.currentStepIndex && activeWorkflow.status === 'ACTIVE' ? "bg-cyan-500 animate-pulse" :
                            "bg-white/10"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeWorkflow.plan.map((step, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "p-3 rounded-lg border transition-all duration-500 flex items-center gap-3",
                          idx < activeWorkflow.currentStepIndex ? "bg-green-500/5 border-green-500/20 opacity-40" :
                          idx === activeWorkflow.currentStepIndex && activeWorkflow.status === 'ACTIVE' ? "bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.1)]" :
                          "bg-white/5 border-white/5 opacity-20"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono",
                          idx < activeWorkflow.currentStepIndex ? "bg-green-500 text-black" :
                          idx === activeWorkflow.currentStepIndex ? "bg-cyan-500 text-black" :
                          "bg-white/10 text-white/40"
                        )}>
                          {idx + 1}
                        </div>
                        <span className={cn(
                          "text-xs font-mono truncate",
                          idx === activeWorkflow.currentStepIndex ? "text-white" : "text-white/60"
                        )}>
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="divide-y divide-white/5">
                    {activeWorkflow?.decisions?.map((decision, idx) => (
                      <div key={idx} className="p-6 hover:bg-white/[0.02] transition-colors group">
                        <div className="grid grid-cols-12 gap-6">
                          <div className="col-span-3 space-y-1">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-2 h-2 rounded-full",
                                decision.agent === 'Orchestrator' ? "bg-blue-500" : 
                                decision.agent === 'Risk Analyst' ? "bg-purple-500" :
                                decision.agent === 'Self-Healer' ? "bg-orange-500 animate-pulse" :
                                decision.agent === 'System Monitor' ? "bg-red-500" :
                                decision.agent === 'Executor' ? "bg-cyan-500" : "bg-green-500"
                              )} />
                              <span className="text-xs font-bold font-mono uppercase tracking-wider">{decision.agent}</span>
                            </div>
                            <div className="text-[10px] text-white/20 font-mono">{new Date(decision.timestamp).toLocaleTimeString()}</div>
                          </div>
                          <div className="col-span-9 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <div className="text-[10px] text-white/40 uppercase font-semibold tracking-widest italic">Agent Thought Process</div>
                                <p className="text-sm text-white/80 leading-relaxed">{decision.thought}</p>
                              </div>
                              <button 
                                onClick={() => {
                                  setInterrogating({ decision, agent: decision.agent });
                                  setInterrogationResponse('');
                                  setInterrogationQuery('');
                                }}
                                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors group/btn"
                                title="Interrogate Agent"
                              >
                                <Search className="w-4 h-4 text-white/40 group-hover/btn:text-orange-500" />
                              </button>
                            </div>
                            <div className={cn(
                              "rounded-lg p-4 border transition-colors",
                              decision.status === 'FAILURE' ? "bg-red-500/10 border-red-500/20" :
                              decision.status === 'RETRY' ? "bg-orange-500/10 border-orange-500/20" :
                              "bg-black/40 border-white/5"
                            )}>
                              <div className="flex items-center justify-between mb-2">
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-widest",
                                  decision.status === 'FAILURE' ? "text-red-500" :
                                  decision.status === 'RETRY' ? "text-orange-500" :
                                  "text-orange-500/80"
                                )}>{decision.action}</span>
                                {decision.status === 'SUCCESS' ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : decision.status === 'FAILURE' ? (
                                  <AlertCircle className="w-4 h-4 text-red-500" />
                                ) : (
                                  <Zap className="w-4 h-4 text-orange-500 animate-pulse" />
                                )}
                              </div>
                              <p className="text-xs font-mono text-white/60">{decision.result}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="h-[600px] border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center text-center p-12 space-y-4">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                <Activity className="w-8 h-8 text-white/20" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-white/60">No Active Workflow</h3>
                <p className="text-sm text-white/30 max-w-xs">Initialize a task to see the multi-agent system orchestrate and execute autonomously.</p>
              </div>
            </div>
          )}

          {/* History List */}
          <div className="bg-[#151518] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-white/60 uppercase tracking-[0.2em]">Workflow History</h2>
            </div>
            <div className="divide-y divide-white/5">
              {Array.isArray(workflows) && workflows.map((w) => (
                <button 
                  key={w.id}
                  onClick={() => setActiveWorkflow(w)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center group-hover:bg-orange-500/10 transition-colors">
                      <Shield className="w-5 h-5 text-white/40 group-hover:text-orange-500" />
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium">Workflow {w.id}</div>
                      <div className="text-[10px] text-white/30 uppercase tracking-widest">{w.type} • {new Date(w.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs font-mono text-white/60">{w.riskScore}% Risk</div>
                    </div>
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      w.status === 'COMPLETED' ? "bg-green-500" : "bg-orange-500"
                    )} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Interrogation Modal */}
      <AnimatePresence>
        {interrogating && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInterrogating(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-xl bg-[#151518] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-orange-500/10 flex items-center justify-center">
                    <Search className="w-4 h-4 text-orange-500" />
                  </div>
                  <h3 className="font-bold uppercase tracking-widest text-sm">Interrogate {interrogating.agent}</h3>
                </div>
                <button onClick={() => setInterrogating(null)} className="text-white/40 hover:text-white">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="bg-black/40 rounded-lg p-4 border border-white/5 space-y-2">
                  <div className="text-[10px] text-white/20 uppercase font-bold tracking-widest">Original Decision Context</div>
                  <p className="text-xs text-white/60 italic leading-relaxed">"{interrogating.decision.thought}"</p>
                </div>

                {interrogationResponse && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                  >
                    <div className="text-[10px] text-orange-500 uppercase font-bold tracking-widest">Agent Response</div>
                    <div className="text-sm text-white/90 leading-relaxed bg-orange-500/5 border border-orange-500/10 p-4 rounded-lg">
                      {interrogationResponse}
                    </div>
                  </motion.div>
                )}

                <div className="space-y-3">
                  <div className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Ask for clarification</div>
                  <div className="flex gap-2">
                    <input 
                      autoFocus
                      value={interrogationQuery}
                      onChange={(e) => setInterrogationQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleInterrogate()}
                      placeholder="Why did you prioritize GlobalTech over NexaCorp?"
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-500/50"
                    />
                    <button 
                      onClick={handleInterrogate}
                      disabled={loading}
                      className="bg-orange-600 hover:bg-orange-500 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                    >
                      {loading ? <Zap className="w-4 h-4 animate-spin" /> : "Ask"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
