import { GoogleGenAI, Type } from "@google/genai";

export interface AgentDecision {
  agent: string;
  thought: string;
  action: string;
  result: string;
  timestamp: string;
  status: 'SUCCESS' | 'FAILURE' | 'RETRY' | 'PENDING';
}

export interface WorkflowState {
  id: string;
  task: string;
  type: string;
  status: 'ACTIVE' | 'PENDING_APPROVAL' | 'COMPLETED' | 'FAILED';
  riskScore: number;
  prediction: string;
  plan: string[];
  currentStepIndex: number;
  decisions: AgentDecision[];
  createdAt: string;
  approvalReason?: string;
  chaosMode?: boolean;
  metadata?: Record<string, any>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runOrchestrator(
  task: string, 
  existingState?: WorkflowState,
  onUpdate?: (state: WorkflowState) => void,
  chaosMode: boolean = false
): Promise<WorkflowState> {
  // @ts-ignore
  const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : (import.meta as any).env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not defined. Please check your AI Studio secrets.");
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

  let state: WorkflowState = existingState || {
    id: Math.random().toString(36).substr(2, 9),
    task,
    type: "Analyzing...",
    status: 'ACTIVE',
    riskScore: 0,
    prediction: "Analyzing...",
    plan: [],
    currentStepIndex: 0,
    createdAt: new Date().toISOString(),
    decisions: [],
    chaosMode: chaosMode
  };

  // Ensure chaosMode is updated if passed explicitly
  if (chaosMode !== undefined) {
    state.chaosMode = chaosMode;
  }

  // If we are resuming from approval or failure, skip to execution
  if (state.status === 'PENDING_APPROVAL' || state.status === 'FAILED') {
    const isRetry = state.status === 'FAILED';
    state.status = 'ACTIVE';
    state.decisions.push({
      agent: "Orchestrator",
      thought: isRetry ? "Resuming failed workflow after manual intervention." : "Human approval received. Proceeding to execution phase.",
      action: isRetry ? "Retry Workflow" : "Resume Workflow",
      result: isRetry ? `Restarting from step ${state.currentStepIndex + 1}.` : "Workflow unlocked. Handing off to Executor agent.",
      timestamp: new Date().toISOString(),
      status: 'SUCCESS'
    });
    if (onUpdate) onUpdate(state);
    return await executeWorkflow(state, ai, onUpdate);
  }

  // 1. Planning Phase
  await sleep(1500);
  const planResponse = await ai.models.generateContent({
    model,
    contents: `You are the Nexus Orchestrator. Task: "${task}". 
    ${state.chaosMode ? "WARNING: System is in CHAOS MODE. Be extremely defensive and include safety checks in your plan." : ""}
    1. Categorize this task (e.g., Procurement, Logistics, IT, HR, Finance).
    2. Create a detailed 4-step execution plan. Ensure the plan explicitly addresses any specific constraints mentioned (e.g., cost limits, lead times, specific quantities).
    Return as JSON.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          plan: { type: Type.ARRAY, items: { type: Type.STRING } },
          initialThought: { type: Type.STRING },
          requiresApproval: { type: Type.BOOLEAN, description: "True if cost > $5000 or high risk" },
          approvalReason: { type: Type.STRING, description: "Explanation of why approval is or isn't needed" }
        },
        required: ["category", "plan", "initialThought", "requiresApproval", "approvalReason"]
      }
    }
  });

  const planData = JSON.parse(planResponse.text);
  state.type = planData.category || "General";
  state.plan = planData.plan;
  state.approvalReason = planData.approvalReason;
  state.decisions.push({
    agent: "Orchestrator",
    thought: `${planData.initialThought} | Approval Logic: ${planData.approvalReason}`,
    action: "Planning",
    result: `Plan created: ${planData.plan.join(", ")}`,
    timestamp: new Date().toISOString(),
    status: 'SUCCESS'
  });
  if (onUpdate) onUpdate(state);
  await sleep(2000);

  // 2. Risk & HITL Check
  const riskResponse = await ai.models.generateContent({
    model,
    contents: `Analyze risk for task: "${task}". Predict SLA breach probability (0-100) and provide reasoning.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          reasoning: { type: Type.STRING }
        },
        required: ["score", "reasoning"]
      }
    }
  });

  const riskData = JSON.parse(riskResponse.text);
  state.riskScore = riskData.score;
  state.prediction = riskData.reasoning;
  await sleep(1500);

  if (planData.requiresApproval || state.riskScore > 30) {
    state.status = 'PENDING_APPROVAL';
    const pauseMsg = `SYSTEM: Workflow ${state.id} paused for approval. Reason: ${state.approvalReason || riskData.reasoning}`;
    state.decisions.push({
      agent: "Risk Analyst",
      thought: "High risk or high value detected. Human-in-the-loop intervention required.",
      action: "Request Approval",
      result: `Workflow paused. Waiting for human override. Reason: ${state.approvalReason || riskData.reasoning}`,
      timestamp: new Date().toISOString(),
      status: 'PENDING'
    });
    if (onUpdate) onUpdate(state);
    return state;
  }

  return await executeWorkflow(state, ai, onUpdate);
}

async function executeWorkflow(
  state: WorkflowState, 
  ai: any,
  onUpdate?: (state: WorkflowState) => void
): Promise<WorkflowState> {
  const model = "gemini-3-flash-preview";

  // 3. Execution Phase (The "Network" / Tool Use)
  for (let i = state.currentStepIndex; i < state.plan.length; i++) {
    state.currentStepIndex = i;
    const step = state.plan[i];
    let retryCount = 0;
    const maxRetries = 2;
    let stepSuccess = false;

    while (retryCount <= maxRetries && !stepSuccess) {
      try {
        // Simulate thinking/processing
        await sleep(state.chaosMode ? 4000 : 3000);

        // Random failure simulation (15% base, 40% in chaos mode)
        const failureThreshold = state.chaosMode ? 0.4 : 0.15;
        const shouldFail = Math.random() < failureThreshold;
        
        if (shouldFail && retryCount === 0) {
          throw new Error(`Connection timeout while executing: ${step}`);
        }

        const stepResponse = await ai.models.generateContent({
          model,
          contents: `You are the Executor Agent. 
          Task Context: "${state.task}"
          Full Plan: ${state.plan.join(" -> ")}
          Current Step to Execute: "${step}"
          
          ${state.chaosMode ? "SYSTEM ALERT: Chaos Mode active. Implement redundant verification and defensive execution logic." : ""}
          
          Execute this specific step while keeping the overall task constraints in mind. 
          Describe the technical action taken and the result. Return as JSON.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                thought: { type: Type.STRING },
                action: { type: Type.STRING },
                result: { type: Type.STRING }
              },
              required: ["thought", "action", "result"]
            }
          }
        });

        const stepData = JSON.parse(stepResponse.text);
        state.decisions.push({
          agent: "Executor",
          thought: stepData.thought,
          action: stepData.action,
          result: stepData.result,
          timestamp: new Date().toISOString(),
          status: 'SUCCESS'
        });
        stepSuccess = true;
        await sleep(1000);

      } catch (error: any) {
        retryCount++;
        state.decisions.push({
          agent: "System Monitor",
          thought: `Detected failure in step ${i + 1}: ${error.message}`,
          action: "Trigger Self-Healing",
          result: `Attempting recovery ${retryCount}/${maxRetries}...`,
          timestamp: new Date().toISOString(),
          status: 'FAILURE'
        });
        if (onUpdate) onUpdate(state);

        // Invoke Self-Healer Agent
        await sleep(1500);
        const healResponse = await ai.models.generateContent({
          model,
          contents: `The step "${step}" failed with error: "${error.message}". 
          ${state.chaosMode ? "CRITICAL: System is in CHAOS MODE. Provide an extremely robust recovery strategy that accounts for high network jitter and potential cascading failures." : ""}
          Analyze the failure and provide a recovery strategy. Return as JSON.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                analysis: { type: Type.STRING },
                strategy: { type: Type.STRING },
                adjustment: { type: Type.STRING }
              },
              required: ["analysis", "strategy", "adjustment"]
            }
          }
        });

        const healData = JSON.parse(healResponse.text);
        state.decisions.push({
          agent: "Self-Healer",
          thought: healData.analysis,
          action: healData.strategy,
          result: `Applied adjustment: ${healData.adjustment}. Retrying...`,
          timestamp: new Date().toISOString(),
          status: 'RETRY'
        });
      }
      
      if (onUpdate) onUpdate(state);
      await sleep(1500);
    }

    if (!stepSuccess) {
      state.status = 'FAILED';
      state.decisions.push({
        agent: "Orchestrator",
        thought: "Self-healing failed after multiple attempts.",
        action: "Terminate Workflow",
        result: "Critical failure in execution pipeline. Manual intervention required.",
        timestamp: new Date().toISOString(),
        status: 'FAILURE'
      });
      if (onUpdate) onUpdate(state);
      return state;
    }
  }

  // 4. Final Audit
  await sleep(2500);
  state.status = 'COMPLETED';
  state.decisions.push({
    agent: "Auditor",
    thought: "Verifying execution logs against compliance standards.",
    action: "Final Audit",
    result: "Transaction confirmed. Audit trail sealed.",
    timestamp: new Date().toISOString(),
    status: 'SUCCESS'
  });

  if (onUpdate) onUpdate(state);
  return state;
}

export async function interrogateAgent(agentName: string, decision: AgentDecision, question: string): Promise<string> {
  // @ts-ignore
  const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : (import.meta as any).env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not defined. Please check your AI Studio secrets.");
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

  const response = await ai.models.generateContent({
    model,
    contents: `You are the ${agentName} agent in an enterprise orchestration system. 
    You previously made this decision:
    Thought: ${decision.thought}
    Action: ${decision.action}
    Result: ${decision.result}
    
    The user is asking you this question about your decision: "${question}"
    Provide a concise, professional, and slightly technical explanation of your reasoning.`,
  });

  return response.text || "I am unable to provide further details at this time.";
}



