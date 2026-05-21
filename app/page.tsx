'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Step {
  action: 'navigate' | 'click' | 'fill' | 'assertVisible' | 'assertText' | 'assertUrl';
  locator: string;
  value: string;
  description: string;
  status?: 'pending' | 'active' | 'success' | 'error';
}

interface LogEntry {
  type: 'INFO' | 'STEP' | 'PROGRESS' | 'SUCCESS' | 'ERROR';
  message: string;
  timestamp: string;
}

const TESTJIN_EXAMPLES = [
  {
    label: "🛒 SwagLabs (E-Commerce)",
    url: "https://www.saucedemo.com/",
    prompt: "Fill the username field with 'standard_user', fill the password field with 'secret_sauce', and click the Login button. Once logged in, click the 'Add to cart' button for the Sauce Labs Backpack, and verify the shopping cart badge is visible."
  },
  {
    label: "🔐 Herokuapp (Form Auth)",
    url: "https://the-internet.herokuapp.com/login",
    prompt: "Type 'tomsmith' into the username input and 'SuperSecretPassword!' into the password input. Click the Login button with the icon, and verify the secure area success banner is visible."
  },
  {
    label: "🔎 Wikipedia (Search & Enter)",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    prompt: "Type 'Playwright (software)' into the search bar and press Enter. Verify that the main page heading text is 'Playwright'."
  }
];

export default function Home() {
  // Config & state
  const [extensionId, setExtensionId] = useState<string>('');
  const [extensionConnected, setExtensionConnected] = useState<boolean>(false);
  const [url, setUrl] = useState<string>('https://example.com');
  const [prompt, setPrompt] = useState<string>('Verify that the title exists and click the more information link');
  const [steps, setSteps] = useState<Step[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [tourStep, setTourStep] = useState<'generate' | 'run' | 'export' | null>(null);
  
  // UI Tabs, Copy, and Deep Dive state
  const [activeTab, setActiveTab] = useState<'steps' | 'code'>('steps');
  const [copied, setCopied] = useState<boolean>(false);
  const [showDeepDive, setShowDeepDive] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const activePortRef = useRef<any>(null);

  // Load saved extension ID on mount
  useEffect(() => {
    const savedId = localStorage.getItem('testjin_extension_id');
    if (savedId) {
      setExtensionId(savedId);
    } else {
      // Prefill with a placeholder to make it look clean
      setExtensionId('jdhblbndjocclccigndbpgicdajokdfj'); 
    }
  }, []);

  // Check connection to the Chrome Extension
  useEffect(() => {
    if (!extensionId) {
      setExtensionConnected(false);
      return;
    }

    const checkConnection = () => {
      if (typeof window !== 'undefined' && (window as any).chrome && (window as any).chrome.runtime) {
        try {
          // Attempt to establish a test port connection
          const port = (window as any).chrome.runtime.connect(extensionId);
          if (port) {
            setExtensionConnected(true);
            port.disconnect();
          } else {
            setExtensionConnected(false);
          }
        } catch (e) {
          setExtensionConnected(false);
        }
      } else {
        setExtensionConnected(false);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 3500); // Poll connection status
    return () => clearInterval(interval);
  }, [extensionId]);

  // Scroll terminal logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const saveExtensionId = (id: string) => {
    setExtensionId(id);
    localStorage.setItem('testjin_extension_id', id);
  };

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { type, message, timestamp }]);
  };

  // Generate Playwright TypeScript code from steps
  const generatePlaywrightCode = (testSteps: Step[]): string => {
    if (testSteps.length === 0) {
      return '// Generate a test plan first to see the copy-pasteable Playwright code';
    }

    let code = `import { test, expect } from '@playwright/test';\n\n`;
    code += `test('Generated Web Agent Test', async ({ page }) => {\n`;

    testSteps.forEach((step) => {
      code += `  // ${step.description}\n`;
      const locatorEscaped = step.locator ? step.locator.replace(/"/g, '\\"') : '';
      const valueEscaped = step.value ? step.value.replace(/"/g, '\\"') : '';

      if (step.action === 'navigate') {
        code += `  await page.goto('${step.value}');\n\n`;
      } else if (step.action === 'click') {
        code += `  await page.locator("${locatorEscaped}").click();\n\n`;
      } else if (step.action === 'fill') {
        if (valueEscaped.toLowerCase().endsWith('{enter}')) {
          const cleanVal = valueEscaped.slice(0, -7);
          code += `  await page.locator("${locatorEscaped}").fill("${cleanVal}");\n`;
          code += `  await page.locator("${locatorEscaped}").press("Enter");\n\n`;
        } else {
          code += `  await page.locator("${locatorEscaped}").fill("${valueEscaped}");\n\n`;
        }
      } else if (step.action === 'assertVisible') {
        code += `  await expect(page.locator("${locatorEscaped}")).toBeVisible();\n\n`;
      } else if (step.action === 'assertText') {
        code += `  await expect(page.locator("${locatorEscaped}")).toContainText("${valueEscaped}");\n\n`;
      } else if (step.action === 'assertUrl') {
        code += `  await expect(page).toHaveURL(/${step.value.replace(/\//g, '\\/')}/);\n\n`;
      }
    });

    code = code.trim() + `\n});\n`;
    return code;
  };

  // Copy generated Playwright TS code to clipboard
  const handleCopyCode = () => {
    const code = generatePlaywrightCode(steps);
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Phase 2: Call LLM API proxy to generate test actions JSON
  const generateTestPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !prompt) return;

    setIsLoading(true);
    setError(null);
    setSteps([]);
    setLogs([]);
    setCurrentStepIndex(null);
    setActiveTab('steps');

    addLog('INFO', `Requesting test plan generation for target: ${url}`);
    
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, prompt }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate steps');
      }

      if (!data.steps || !Array.isArray(data.steps)) {
        throw new Error('Invalid format returned from generator proxy');
      }

      const formattedSteps = data.steps.map((step: any) => ({
        ...step,
        status: 'pending' as const
      }));

      setSteps(formattedSteps);
      if (tourStep === 'generate') {
        setTourStep('run');
      }
      addLog('SUCCESS', `Successfully generated ${formattedSteps.length} automation steps.`);
    } catch (err: any) {
      setError(err.message || 'An error occurred during step generation.');
      addLog('ERROR', err.message || 'Generation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Phase 4: Execute actions via Chrome Extension connection port
  const startAutomation = () => {
    if (steps.length === 0 || !extensionConnected) return;

    setIsExecuting(true);
    setCurrentStepIndex(null);
    setLogs([]);
    
    // Reset steps status to pending
    setSteps((prev) => prev.map(s => ({ ...s, status: 'pending' })));
    addLog('INFO', 'Establishing connection with Testjin Extension...');

    try {
      const port = (window as any).chrome.runtime.connect(extensionId);
      activePortRef.current = port;

      port.postMessage({
        type: 'START_TEST',
        url: url,
        actions: steps
      });

      port.onMessage.addListener((msg: any) => {
        if (msg.type === 'INFO') {
          addLog('INFO', msg.message);
        } else if (msg.type === 'STEP_START') {
          setCurrentStepIndex(msg.stepIndex);
          setSteps((prev) => prev.map((step, idx) => 
            idx === msg.stepIndex ? { ...step, status: 'active' } : step
          ));
          addLog('STEP', `[Step ${msg.stepIndex + 1}] Executing: ${msg.action.description}`);
        } else if (msg.type === 'STEP_PROGRESS') {
          addLog('PROGRESS', msg.message);
        } else if (msg.type === 'STEP_COMPLETE') {
          if (msg.status === 'success') {
            setSteps((prev) => prev.map((step, idx) => 
              idx === msg.stepIndex ? { ...step, status: 'success' } : step
            ));
            addLog('SUCCESS', msg.message);
          } else {
            setSteps((prev) => prev.map((step, idx) => 
              idx === msg.stepIndex ? { ...step, status: 'error' } : step
            ));
            addLog('ERROR', `Error: ${msg.error}`);
          }
        } else if (msg.type === 'TEST_COMPLETE') {
          setIsExecuting(false);
          setCurrentStepIndex(null);
          if (msg.status === 'success') {
            addLog('SUCCESS', `Automation E2E run finished: ${msg.message}`);
            setTourStep((curr) => curr === 'run' ? 'export' : curr);
          } else {
            addLog('ERROR', `Automation run aborted: ${msg.message}`);
          }
          port.disconnect();
          activePortRef.current = null;
        }
      });

      port.onDisconnect.addListener(() => {
        setIsExecuting(false);
        addLog('INFO', 'Extension port disconnected.');
        activePortRef.current = null;
      });

    } catch (e: any) {
      setIsExecuting(false);
      setError(`Failed to connect to extension: ${e.message}`);
      addLog('ERROR', `Connection failed: ${e.message}`);
    }
  };

  const stopAutomation = () => {
    if (activePortRef.current) {
      activePortRef.current.disconnect();
      activePortRef.current = null;
    }
    setIsExecuting(false);
    addLog('INFO', 'Test execution aborted by user.');
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0B0D12]">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0F1219] px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-500 bg-clip-text text-transparent flex items-center gap-2">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 320 499" 
                className="h-8 w-auto text-cyan-400 fill-current shrink-0"
              >
                <path 
                  style={{ stroke: 'none', fillRule: 'nonzero', fill: 'currentColor', fillOpacity: 1 }} 
                  d="M 234.394531 28.050781 L 232.183594 30.886719 C 228.300781 35.871094 227.472656 38.121094 227.777344 42.871094 C 228.160156 48.800781 230.550781 53.355469 236.195312 58.886719 C 242.144531 64.71875 249.597656 69.066406 261.574219 73.691406 C 273.539062 78.316406 280.753906 81.941406 286.34375 86.136719 C 297.554688 94.554688 302.257812 103.988281 300.59375 114.703125 C 298.984375 125.074219 291.863281 132.761719 276.964844 140.210938 C 273.84375 141.769531 270.554688 143.273438 269.660156 143.550781 C 268.765625 143.828125 265.902344 145.484375 263.296875 147.230469 C 259.011719 150.101562 258.476562 150.292969 257.691406 149.21875 C 256.921875 148.164062 256.292969 148.125 251.992188 148.871094 C 245.914062 149.921875 237.558594 152.695312 233.761719 154.921875 C 230.0625 157.089844 225.121094 162.125 224.144531 164.71875 C 221.96875 170.511719 223.890625 176.871094 230.875 186.949219 C 237.453125 196.4375 239.316406 200.632812 239.339844 206.023438 C 239.355469 209.609375 239.027344 210.816406 237.378906 213.191406 C 234.785156 216.929688 230.332031 219.265625 221.574219 221.480469 C 217.648438 222.472656 213.335938 223.746094 211.996094 224.3125 L 209.558594 225.335938 L 209.542969 231.242188 C 209.535156 235.074219 209.078125 238.460938 208.242188 240.878906 C 206.417969 246.164062 201.195312 251.648438 195.605469 254.15625 C 187.453125 257.8125 179.207031 257.136719 171.886719 252.214844 C 156.820312 242.085938 158.746094 219.066406 175.289062 211.617188 C 181.113281 208.992188 189.058594 208.792969 194.945312 211.125 C 197.054688 211.960938 199.054688 212.472656 199.390625 212.265625 C 201.136719 211.191406 203.011719 205.765625 202.957031 201.953125 C 202.878906 196.515625 201.246094 193.570312 194.015625 185.832031 C 186.4375 177.722656 183.578125 172.257812 183.125 165.007812 C 182.242188 150.914062 190.722656 137.660156 205.167969 130.558594 C 212.519531 126.945312 220.691406 124.601562 233.898438 122.3125 C 247.101562 120.027344 251.3125 118.960938 256.136719 116.679688 C 266.589844 111.734375 271.289062 102.917969 268.527344 93.429688 C 266.351562 85.945312 260.445312 80.441406 242.203125 68.886719 C 232.28125 62.605469 227.492188 58.125 225.085938 52.875 C 221.289062 44.59375 223.542969 36.554688 231.390625 30.402344 Z M 217.511719 80.273438 C 218.136719 80.300781 218.71875 80.429688 219.070312 80.648438 C 220.515625 81.554688 220.917969 84.175781 219.816406 85.503906 C 218.707031 86.839844 215.296875 86.820312 214.179688 85.476562 C 212.816406 83.835938 213.886719 80.957031 216.066406 80.410156 C 216.324219 80.34375 216.601562 80.304688 216.882812 80.285156 C 217.09375 80.269531 217.304688 80.265625 217.511719 80.273438 Z M 237.742188 95.035156 C 240.273438 95.035156 241.710938 97.59375 240.472656 99.90625 C 239.949219 100.886719 238.976562 101.414062 237.703125 101.414062 C 235.363281 101.414062 234.039062 100.261719 234.039062 98.222656 C 234.039062 96.175781 235.363281 95.035156 237.742188 95.035156 Z M 174.441406 155.707031 C 177.007812 155.625 178.984375 158.675781 176.875 161.003906 C 175.375 162.660156 173.507812 162.757812 172.003906 161.257812 C 170.386719 159.640625 170.636719 157.605469 172.617188 156.3125 C 173.226562 155.910156 173.851562 155.726562 174.441406 155.707031 Z M 36.078125 158.117188 L 84.324219 158.117188 L 84.324219 211.988281 L 129.027344 211.988281 L 129.027344 238.214844 L 36.078125 238.214844 Z M 36.078125 275.070312 L 84.324219 275.070312 L 84.324219 298.71875 C 84.324219 311.726562 84.648438 324.0625 85.042969 326.132812 C 86.617188 334.429688 91.878906 342.160156 98.160156 345.410156 C 103.140625 347.984375 107.835938 348.878906 118.492188 349.285156 L 128.886719 349.683594 L 129.207031 351.539062 C 129.382812 352.558594 129.429688 355.628906 129.308594 358.355469 C 129.191406 361.085938 129.078125 370.734375 129.058594 379.796875 L 129.023438 396.277344 L 121.042969 396.148438 C 100.820312 395.824219 89.515625 393.90625 77.324219 388.730469 C 61.339844 381.941406 50.214844 371.613281 43.214844 357.070312 C 37.175781 344.519531 36.078125 336.039062 36.078125 301.953125 Z M 206.414062 275.761719 L 206.199219 348.601562 L 205.980469 421.441406 L 204.347656 427.109375 C 196.046875 455.929688 175.15625 474.691406 145.183594 480.242188 C 141.957031 480.839844 135.398438 481.574219 130.613281 481.875 L 121.910156 482.421875 L 122.097656 459.734375 L 122.285156 437.050781 L 125.480469 436.84375 C 127.234375 436.730469 130.5625 436.160156 132.875 435.578125 C 145.109375 432.496094 155.242188 423.273438 158.144531 412.578125 C 158.792969 410.1875 159.03125 392.746094 159.097656 342.761719 L 159.183594 276.132812 L 182.800781 275.949219 Z M -101.558594 540.746094 C -99.675781 540.660156 -97.660156 540.695312 -95.503906 540.875 C -87.363281 541.542969 -79.28125 542.605469 -71.289062 544.285156 C -64.433594 545.578125 -57.707031 547.132812 -51.15625 549.558594 C -44.019531 552.1875 -37.628906 556.304688 -31.4375 560.652344 C -26.367188 563.558594 -22.027344 567.476562 -17.25 570.789062 C -16.289062 571.644531 -15.289062 571.734375 -14.828125 571.804688 C -14.644531 571.71875 -14.316406 571.613281 -13.800781 571.476562 C -10.691406 570.691406 -7.539062 570.117188 -4.367188 569.671875 C -4.402344 569.675781 -4.425781 569.671875 -4.4375 569.667969 C -4.4375 569.667969 -4.4375 569.667969 -4.445312 569.667969 L -4.445312 569.65625 C -4.394531 569.550781 -2.824219 569.066406 -2.242188 568.863281 C -0.117188 568.109375 2.042969 567.546875 4.230469 567.03125 C 7.515625 566.230469 10.875 565.839844 14.238281 565.589844 C 19.75 565.320312 25.273438 565.359375 30.792969 565.339844 C 38.429688 565.320312 46.0625 565.3125 53.699219 565.304688 C 58.796875 565.304688 63.894531 565.300781 68.992188 565.300781 C 74.71875 565.300781 80.445312 565.300781 86.171875 565.300781 C 91.101562 565.300781 96.03125 565.300781 100.960938 565.300781 C 106.3125 565.300781 111.660156 565.300781 117.011719 565.300781 L 132.1875 565.300781 C 138.773438 565.621094 145.285156 564.859375 151.824219 564.203125 C 158.59375 563.480469 165.371094 562.804688 172.167969 562.386719 C 176.800781 562.1875 181.300781 560.847656 185.890625 560.121094 C 191.601562 558.367188 197.492188 557.328125 203.402344 556.507812 C 209.671875 555.738281 215.984375 555.414062 222.289062 555.140625 C 226.46875 554.96875 230.652344 554.921875 234.835938 554.878906 C 243.804688 554.347656 247.449219 555.90625 254.917969 561.074219 C 263.371094 570.738281 261.792969 581.417969 257.445312 592.359375 C 255.195312 595.941406 253.882812 600.671875 251.597656 604.519531 C 259.3125 604 266.96875 604.199219 274.078125 606.390625 C 276.542969 607.152344 278.78125 608.507812 281.136719 609.566406 C 293.492188 619.160156 294.363281 629.816406 289.832031 643.53125 C 285.867188 654.417969 277.03125 660.058594 266.660156 663.953125 C 251.703125 668.195312 236.125 668.347656 220.707031 668.207031 C 205.203125 667.898438 189.699219 667.421875 174.195312 667.027344 C 164.378906 666.769531 154.558594 666.671875 144.742188 666.597656 C 134.441406 666.535156 124.140625 666.523438 113.835938 666.511719 C 102.742188 666.503906 91.644531 666.5 80.546875 666.5 C 71.851562 666.496094 63.152344 666.496094 54.457031 666.496094 C 46.398438 666.496094 38.339844 666.496094 30.285156 666.496094 C 24.160156 666.496094 18.035156 666.496094 11.910156 666.496094 C 7.789062 666.777344 3.480469 665.9375 -0.507812 666.898438 C -2.800781 667.367188 -5.085938 667.875 -7.375 668.382812 C -38.777344 675.375 -47.539062 646.371094 -21.421875 636.25 C -22.519531 633.296875 -23.371094 630.238281 -23.925781 627.058594 C -23.621094 623.96875 -24.003906 620.734375 -23.007812 617.796875 C -21.277344 612.675781 -17.898438 609.226562 -13.808594 606.621094 C -16.757812 606.757812 -19.714844 606.53125 -22.664062 605.808594 C -27.894531 604.535156 -32.898438 602.554688 -37.285156 599.371094 C -42.097656 595.980469 -46.511719 592.089844 -51.628906 589.125 C -55.472656 586.378906 -59.261719 583.699219 -63.71875 582.117188 C -68.433594 580.09375 -73.550781 579.65625 -78.496094 578.425781 C -84.128906 577.234375 -89.816406 576.558594 -95.503906 575.769531 C -127.613281 571.304688 -129.804688 542.054688 -101.558594 540.746094 Z M 257.605469 630.664062 C 257.59375 630.664062 257.578125 630.667969 257.558594 630.675781 C 257.558594 630.695312 257.566406 630.714844 257.566406 630.730469 C 257.597656 630.710938 257.617188 630.691406 257.625 630.679688 C 257.625 630.679688 257.625 630.675781 257.625 630.675781 L 257.625 630.664062 C 257.625 630.664062 257.613281 630.664062 257.609375 630.664062 Z M 263.324219 639.480469 C 263.710938 639.722656 264.132812 639.992188 264.59375 640.300781 C 264.953125 640.289062 265.539062 640.597656 265.675781 640.265625 C 265.90625 639.699219 264.992188 639.527344 263.324219 639.480469 Z M 263.324219 639.480469"
                />
              </svg>
              Testjin
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Zero-Infra Workspace
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Connection Status Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#161B22] border border-slate-800 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${extensionConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'}`} />
              <span className="text-slate-300 font-medium">
                Extension: {extensionConnected ? 'Connected' : 'Not Detected'}
              </span>
            </div>

            {/* Input field for Extension ID */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium font-mono">ID:</span>
              <input
                type="text"
                value={extensionId}
                onChange={(e) => saveExtensionId(e.target.value)}
                placeholder="Chrome Extension ID"
                className="w-40 md:w-64 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500 transition"
              />
            </div>
            
            <a 
              href="https://github.com/joshchamo/Testjin" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-800 flex items-center justify-center shrink-0"
              title="View on GitHub"
            >
              <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.11.82-.26.82-.577v-2.234c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22v3.293c0 .319.22.694.825.576C20.565 21.795 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Test Setup Form */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          <div className="glassmorphic p-5 rounded-2xl glow-card shadow-2xl flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-white border-b border-slate-800 pb-2">
              Configuration
            </h2>

            {/* Try an Example Section */}
            <div className="flex flex-col gap-2 border-b border-slate-800 pb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Try an Example:
              </span>
              <div className="flex flex-col gap-2">
                {TESTJIN_EXAMPLES.map((ex, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setUrl(ex.url);
                      setPrompt(ex.prompt);
                      setSteps([]);
                      setError(null);
                      setTourStep('generate');
                      setActiveTab('steps');
                    }}
                    className="text-left text-xs bg-slate-900/60 hover:bg-cyan-950/30 hover:border-cyan-500/50 border border-slate-800/80 rounded-xl p-2.5 transition active:scale-[0.98] text-slate-300 font-medium cursor-pointer"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tour Helper Banner */}
            {tourStep && (
              <div className="bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 p-3.5 rounded-xl text-xs flex gap-2.5">
                <svg className="h-5 w-5 shrink-0 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div>
                  <p className="font-bold">Guided Product Tour</p>
                  <p className="text-slate-400 mt-0.5 leading-relaxed">
                    {tourStep === 'generate' && "Step 1: Click the 'Generate Test Plan' button below to let Gemini analyze the page markdown."}
                    {tourStep === 'run' && "Step 2: Great! Now click the green 'Run E2E Test' button on the Action List to start execution."}
                    {tourStep === 'export' && "Step 3: Success! Select the 'Playwright TS Exporter' tab to copy your production-ready script."}
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={generateTestPlan} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Target Website URL
                </label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full bg-[#0E1117] border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Testing Prompt (Natural Language)
                </label>
                <textarea
                  required
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Click the More information link and verify that the header contains Example Domain."
                  className="w-full bg-[#0E1117] border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || isExecuting}
                className={`w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-600 text-white font-medium py-2.5 rounded-lg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10 cursor-pointer ${
                  tourStep === 'generate' ? 'tour-pulse-active border border-cyan-400' : ''
                }`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating steps...
                  </>
                ) : (
                  <>
                    <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Test Plan
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Extension Installation Guide / Incognito Tip */}
          {!extensionConnected ? (
            <div className="bg-slate-900/60 border border-amber-500/20 rounded-2xl p-5 text-sm flex flex-col gap-3">
              <h3 className="font-semibold text-amber-400 flex items-center gap-2">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Extension Not Detected
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                The majority of Testjin's core features are fully functional as-is:
              </p>
              <ul className="list-disc list-inside text-xs text-slate-300 flex flex-col gap-1 pl-1">
                <li>Generating Test Plans via NLP</li>
                <li>Generating detailed Action Lists</li>
                <li>Compiling & exporting Playwright TS Code</li>
              </ul>
              <div className="border-t border-slate-800 my-1" />
              <p className="text-xs text-slate-400 leading-relaxed font-semibold text-amber-300">
                To run tests visually in the browser (E2E execution), load the local extension:
              </p>
              <ol className="list-decimal list-inside text-xs text-slate-300 flex flex-col gap-1.5 pl-1">
                <li>Open Chrome to <code className="text-cyan-400 font-mono">chrome://extensions/</code></li>
                <li>Toggle <strong>Developer Mode</strong> in the top-right</li>
                <li>Click <strong>Load unpacked</strong></li>
                <li>Select this directory:<br/><code className="text-cyan-400 font-mono text-[10px] break-all block mt-0.5 bg-slate-950 p-1 rounded">[your-cloned-repo]/extension</code></li>
                <li>Copy the extension's ID and paste it in the field above</li>
              </ol>
            </div>
          ) : (
            <div className="bg-[#0F1219]/60 border border-cyan-500/10 rounded-2xl p-5 text-sm flex flex-col gap-2.5">
              <h3 className="font-semibold text-cyan-400 flex items-center gap-2">
                <svg className="h-4.5 w-4.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Incognito E2E Tip
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Testjin automatically launches target websites in an <strong>Incognito window</strong> to block Password Manager popups and translate dialogs from breaking synthetic events.
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-semibold bg-slate-900/40 p-2 rounded border border-slate-800">
                To allow this, visit <code className="text-cyan-400 font-mono text-[10px]">chrome://extensions</code>, click <strong>Details</strong> on Testjin, and toggle <strong>"Allow in Incognito"</strong>.
              </p>
            </div>
          )}
        </section>

        {/* Right Side: Step Viewer / Code Exporter and Streaming Terminal Logs */}
        <section className="lg:col-span-8 flex flex-col gap-6">
          {error && (
            <div className="bg-red-950/40 border border-red-500/25 text-red-300 p-4 rounded-xl text-sm flex gap-2">
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold">Generation Failed</p>
                <p className="text-xs text-red-400 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Test Steps Execution / Preview Board */}
          <div className="glassmorphic rounded-2xl p-5 shadow-2xl flex flex-col gap-4 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActiveTab('steps')}
                  className={`text-xs font-bold uppercase tracking-wider py-1.5 px-3.5 rounded-lg border transition ${
                    activeTab === 'steps'
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'text-slate-400 border-transparent hover:text-white'
                  }`}
                >
                  Action List
                </button>
                 <button
                  onClick={() => {
                    setActiveTab('code');
                    if (tourStep === 'export') {
                      setTourStep(null);
                    }
                  }}
                  className={`text-xs font-bold uppercase tracking-wider py-1.5 px-3.5 rounded-lg border transition ${
                    activeTab === 'code'
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'text-slate-400 border-transparent hover:text-white'
                  } ${tourStep === 'export' ? 'tour-pulse-active border border-cyan-400' : ''}`}
                >
                  Playwright TS Exporter
                </button>
              </div>

              {steps.length > 0 && (
                <div className="flex items-center gap-2">
                  {activeTab === 'code' ? (
                    <button
                      onClick={handleCopyCode}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition active:scale-95 cursor-pointer border border-slate-700"
                    >
                      {copied ? (
                        <>
                          <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="h-3.5 w-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          Copy Playwright Code
                        </>
                      )}
                    </button>
                  ) : !isExecuting ? (
                    <button
                      onClick={startAutomation}
                      disabled={!extensionConnected}
                      className={`bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${
                        tourStep === 'run' ? 'tour-pulse-active border border-emerald-400' : ''
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                      Run E2E Test
                    </button>
                  ) : (
                    <button
                      onClick={stopAutomation}
                      className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Stop Run
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Content Switcher */}
            <div className="flex-1 min-h-[240px] max-h-[360px] overflow-y-auto pr-1">
              {steps.length === 0 ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-slate-600 gap-2 border-2 border-dashed border-slate-800/60 rounded-xl p-8">
                  <svg className="h-10 w-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <p className="text-sm font-medium">No test steps generated yet</p>
                  <p className="text-xs text-slate-600 text-center max-w-xs">
                    Input a target website and testing prompt, then click "Generate Test Plan" to compile actions.
                  </p>
                </div>
              ) : activeTab === 'steps' ? (
                // 1. Actions sequential list view
                <div className="flex flex-col gap-3">
                  {steps.map((step, index) => {
                    const isActive = index === currentStepIndex;
                    return (
                      <div
                        key={index}
                        className={`p-3.5 rounded-xl border flex gap-3 transition-all duration-300 ${
                          isActive
                            ? 'bg-slate-900 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.06)]'
                            : step.status === 'success'
                            ? 'bg-slate-900/30 border-emerald-500/20'
                            : step.status === 'error'
                            ? 'bg-red-950/10 border-red-500/20'
                            : 'bg-slate-900/20 border-slate-800/80'
                        }`}
                      >
                        {/* Step Number Badge */}
                        <div className="flex flex-col items-center shrink-0">
                          <div className={`h-6.5 w-6.5 rounded-full flex items-center justify-center font-bold text-xs ${
                            isActive
                              ? 'bg-cyan-500 text-slate-950 pulsing-glow'
                              : step.status === 'success'
                              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                              : step.status === 'error'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {index + 1}
                          </div>
                          {index < steps.length - 1 && (
                            <div className={`w-0.5 flex-1 my-1 ${
                              step.status === 'success' ? 'bg-emerald-500/20' : 'bg-slate-850'
                            }`} />
                          )}
                        </div>

                        {/* Step Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full font-mono ${
                              step.action === 'navigate' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                              step.action === 'click' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                              step.action === 'fill' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              step.action === 'assertVisible' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              step.action === 'assertText' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                              'bg-pink-500/10 text-pink-400 border border-pink-500/20'
                            }`}>
                              {step.action}
                            </span>
                            {step.locator && (
                              <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px] md:max-w-[320px] bg-[#0E1117] px-1.5 py-0.5 rounded border border-slate-850">
                                {step.locator}
                              </span>
                            )}
                            {step.value && (
                              <span className="text-[11px] font-mono text-slate-500 truncate max-w-[150px] bg-[#0E1117] px-1.5 py-0.5 rounded border border-slate-850">
                                "{step.value}"
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-300 font-medium leading-relaxed">
                            {step.description}
                          </p>
                        </div>

                        {/* Status indicator */}
                        <div className="shrink-0 flex items-center">
                          {step.status === 'success' && (
                            <svg className="h-5.5 w-5.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {step.status === 'error' && (
                            <svg className="h-5.5 w-5.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          )}
                          {isActive && (
                            <div className="flex gap-1">
                              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" />
                              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                // 2. Playwright TS code view
                <div className="bg-[#05070A] rounded-xl border border-slate-850 p-4 overflow-x-auto font-mono text-xs select-text">
                  <div className="table w-full border-collapse">
                    {generatePlaywrightCode(steps).split('\n').map((line, idx) => {
                      const isComment = line.trim().startsWith('//');
                      const isImport = line.trim().startsWith('import');
                      const isTest = line.trim().startsWith('test(') || line.trim() === '});';
                      
                      let textColor = 'text-slate-300';
                      if (isComment) textColor = 'text-slate-500 italic';
                      else if (isImport) textColor = 'text-purple-400';
                      else if (isTest) textColor = 'text-blue-400';
                      else if (line.includes('page.goto') || line.includes('page.locator') || line.includes('expect')) textColor = 'text-cyan-400';

                      return (
                        <div key={idx} className="table-row">
                          <span className="table-cell text-right pr-4 text-slate-700 select-none text-[11px] w-6 text-slate-600 font-mono">
                            {idx + 1}
                          </span>
                          <span className={`table-cell ${textColor} whitespace-pre`}>
                            {line}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Real-time Streaming Logs CLI terminal */}
          <div className="bg-[#05070A] rounded-2xl border border-slate-800/80 shadow-2xl overflow-hidden flex flex-col h-64">
            <div className="bg-[#0A0D14] px-4 py-2.5 flex items-center justify-between border-b border-slate-900">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-red-500/60" />
                  <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
                  <span className="h-3 w-3 rounded-full bg-green-500/60" />
                </div>
                <span className="text-xs font-mono font-semibold text-slate-500">
                  execution-relay-console
                </span>
              </div>
              <span className="text-[10px] font-mono text-cyan-500 px-2 py-0.5 bg-cyan-500/10 rounded">
                LIVE STREAM
              </span>
            </div>

            {/* Logs Window */}
            <div className="p-4 flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed flex flex-col gap-1.5 text-slate-350">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
                  Waiting for execution logs...
                </div>
              ) : (
                logs.map((log, index) => {
                  let colorClass = 'text-slate-400';
                  if (log.type === 'STEP') colorClass = 'text-indigo-400 font-semibold';
                  if (log.type === 'PROGRESS') colorClass = 'text-cyan-400';
                  if (log.type === 'SUCCESS') colorClass = 'text-emerald-400 font-bold';
                  if (log.type === 'ERROR') colorClass = 'text-red-400 font-bold';

                  return (
                    <div key={index} className="flex gap-2">
                      <span className="text-slate-600 shrink-0 select-none">[{log.timestamp}]</span>
                      <span className={`${colorClass} shrink-0 select-none font-bold`}>
                        [{log.type}]
                      </span>
                      <span className="text-slate-300 break-all">{log.message}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </section>

      </main>

      {/* Technical Deep Dive Panel */}
      <section className="max-w-7xl w-full mx-auto px-4 md:px-6 pb-6">
        <div className="border border-slate-800/80 bg-[#0F1219]/40 rounded-2xl overflow-hidden shadow-xl">
          <button
            onClick={() => setShowDeepDive(!showDeepDive)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-800/30 transition text-left cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <svg className="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              <span className="text-sm font-semibold text-slate-200">Technical Architecture &amp; Deep Dive</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-indigo-400 font-mono hidden sm:inline">view engineering specifications</span>
              <svg 
                className={`h-4.5 w-4.5 text-slate-400 transition-transform duration-300 ${showDeepDive ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {showDeepDive && (
            <div className="p-6 border-t border-slate-800/80 bg-[#0A0D14]/80 text-sm text-slate-350 flex flex-col gap-6 leading-relaxed">
              {/* Architecture Columns */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-[#0B0D12]/60 p-4 rounded-xl border border-slate-800/40">
                  <h4 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-2">1. The Command Center</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    React workspace built on Next.js. Retrieves layouts using the Jina Reader API to get a semantic Markdown representation of the page DOM. Passes layout markdown + instructions to Google Gemini 2.5 Flash Lite using dynamic structured JSON schemas to deterministically model sequential test plans.
                  </p>
                </div>
                <div className="bg-[#0B0D12]/60 p-4 rounded-xl border border-slate-800/40">
                  <h4 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-2">2. The Execution Engine</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Manifest V3 Extension background/content scripts acting as a headless sandbox. Relays actions via message-passing ports, executing native DOM sequences to bypass synthetic framework traps (React/Vue), and verifying strict geometric dimensions for visibility.
                  </p>
                </div>
                <div className="bg-[#0B0D12]/60 p-4 rounded-xl border border-slate-800/40">
                  <h4 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-2">3. Floating Inspector</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Uses Chrome's display configuration APIs to query viewport bounds. Automatically splits coordinates, spawning the target testing page fully maximized in the background, and anchoring the Testjin application console to the right side as a floating inspector panel.
                  </p>
                </div>
              </div>

              {/* In-depth details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div>
                    <h4 className="font-semibold text-slate-200 text-sm mb-1.5">💡 Decoupled Automation Sandbox</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Unlike heavy Playwright setups running in virtual machines (which incur high latency and compute costs), Testjin compiles test runs into code entirely in the client-side sandbox. It is zero-infrastructure: no runner nodes, local Docker instances, or remote headful setups.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-200 text-sm mb-1.5">⚡ SPA Event Pipeline Integration</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Standard DOM events fail on reactive SPAs because React/Vue override element setter descriptors. Testjin intercepts element properties at the prototype level, triggering full event chains (<code className="text-cyan-400 text-[10px]">input</code> &rarr; <code className="text-cyan-400 text-[10px]">change</code> &rarr; <code className="text-cyan-400 text-[10px]">keydown</code>) and native submits to guarantee framework state synchronization.
                    </p>
                  </div>
                </div>

                <div className="bg-[#080A0E] p-4 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-200 text-sm mb-1.5">🧑‍💻 Developer &amp; Project Contact</h4>
                    <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                      Created by <strong>Josh Chamo</strong>. Designed as a zero-infra AI agent workbench for automated QA analysis, custom selectors compilation, and Playwright execution scaffolding.
                    </p>
                    <div className="flex flex-col gap-1.5 font-mono text-xs text-slate-300">
                      <div><span className="text-slate-500">Developer:</span> Josh Chamo</div>
                      <div><span className="text-slate-500">Email:</span> <a href="mailto:joshchamo@gmail.com" className="text-cyan-400 hover:underline">joshchamo@gmail.com</a></div>
                      <div><span className="text-slate-500">Repository:</span> <a href="https://github.com/joshchamo/Testjin" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">github.com/joshchamo/Testjin</a></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-[#07090F] py-4 text-center text-xs text-slate-600">
        Testjin Workbench &copy; {new Date().getFullYear()} &middot; Decoupled Chrome Extension Runner
      </footer>
    </div>
  );
}
