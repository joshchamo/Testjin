// Background Service Worker for Testjin QA Runner

// Key: tabId, Value: { port, actions, currentIndex, status: 'loading' | 'executing' | 'idle' }
const activeJobs = new Map();

// Helper to send log messages to the Web UI port
function sendLog(port, data) {
  if (port) {
    try {
      port.postMessage(data);
    } catch (e) {
      console.warn("Failed to send message to UI port. Port might be closed.", e);
    }
  }
}

// Coordinate the execution of the next step
async function runNextStep(tabId) {
  const job = activeJobs.get(tabId);
  if (!job) return;

  const { port, actions, currentIndex } = job;

  if (currentIndex >= actions.length) {
    sendLog(port, {
      type: "TEST_COMPLETE",
      status: "success",
      message: "All steps completed successfully!"
    });
    activeJobs.delete(tabId);
    return;
  }

  const action = actions[currentIndex];
  sendLog(port, {
    type: "STEP_START",
    stepIndex: currentIndex,
    action: action
  });

  // Check if target tab is still available
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    sendLog(port, {
      type: "TEST_COMPLETE",
      status: "failure",
      message: `Target tab was closed or lost.`
    });
    activeJobs.delete(tabId);
    return;
  }

  // Handle explicit navigate action in the background script itself to ensure tab navigates properly
  if (action.action === 'navigate') {
    try {
      // 🛑 The Fix: Increment the index BEFORE navigating!
      job.currentIndex++;
      job.status = 'loading';
      
      sendLog(port, {
        type: "STEP_PROGRESS",
        stepIndex: currentIndex,
        message: `Navigating to ${action.value}...`
      });

      await chrome.tabs.update(tabId, { url: action.value });
      
      sendLog(port, {
        type: "STEP_COMPLETE",
        stepIndex: currentIndex,
        status: "success",
        message: `Navigated to ${action.value}`
      });
      
      // We stop here. The tabs.onUpdated listener will catch the load and trigger the next step.
      return;
    } catch (err) {
      sendLog(port, {
        type: "STEP_COMPLETE",
        stepIndex: currentIndex,
        status: "failure",
        error: `Navigation failed: ${err.message}`
      });
      sendLog(port, {
        type: "TEST_COMPLETE",
        status: "failure",
        message: `Execution stopped due to failure at step ${currentIndex + 1}.`
      });
      activeJobs.delete(tabId);
      return;
    }
  }

  // Send action to the content script for DOM execution
  chrome.tabs.sendMessage(tabId, { type: "EXECUTE_ACTION", action, stepIndex: currentIndex }, async (response) => {
    // Check if runtime error occurred (e.g. content script not loaded yet)
    if (chrome.runtime.lastError) {
      const errMsg = chrome.runtime.lastError.message;
      sendLog(port, {
        type: "STEP_PROGRESS",
        stepIndex: currentIndex,
        message: `Retrying step: connection to page not ready yet (${errMsg})...`
      });
      // Wait a short moment and retry
      setTimeout(() => {
        runNextStep(tabId);
      }, 1000);
      return;
    }

    if (!response) {
      sendLog(port, {
        type: "STEP_COMPLETE",
        stepIndex: currentIndex,
        status: "failure",
        error: "Content script did not respond."
      });
      sendLog(port, {
        type: "TEST_COMPLETE",
        status: "failure",
        message: `Execution stopped due to failure at step ${currentIndex + 1}.`
      });
      activeJobs.delete(tabId);
      return;
    }

    if (response.status === "success") {
      sendLog(port, {
        type: "STEP_COMPLETE",
        stepIndex: currentIndex,
        status: "success",
        message: response.message || "Executed successfully."
      });

      // Increment step index
      job.currentIndex++;

      // Wait a short duration to see if the action triggered a page navigation
      setTimeout(async () => {
        try {
          const currentTab = await chrome.tabs.get(tabId);
          if (currentTab.status === 'loading') {
            // Tab is loading a new page, let onUpdated handle the next step
            job.status = 'loading';
            sendLog(port, {
              type: "STEP_PROGRESS",
              stepIndex: job.currentIndex,
              message: "Waiting for new page to load..."
            });
          } else {
            // Execute the next step immediately
            job.status = 'executing';
            runNextStep(tabId);
          }
        } catch (e) {
          // Tab might have closed
          runNextStep(tabId);
        }
      }, 500);

    } else {
      sendLog(port, {
        type: "STEP_COMPLETE",
        stepIndex: currentIndex,
        status: "failure",
        error: response.error || "Unknown content script failure."
      });
      sendLog(port, {
        type: "TEST_COMPLETE",
        status: "failure",
        message: `Execution stopped due to failure at step ${currentIndex + 1}.`
      });
      activeJobs.delete(tabId);
    }
  });
}

// Listen for external port connections from the Web UI
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log("Connected to web app port:", port.name);

  port.onMessage.addListener(async (message) => {
    if (message.type === "START_TEST") {
      const { url, actions } = message;

      if (!url || !actions || !Array.isArray(actions)) {
        sendLog(port, {
          type: "TEST_COMPLETE",
          status: "failure",
          message: "Invalid payload sent to Chrome Extension."
        });
        return;
      }

      sendLog(port, {
        type: "INFO",
        message: `Initializing test execution on: ${url}`
      });

      const vercelWindowId = port.sender?.tab?.windowId;

      try {
        if (vercelWindowId) {
          chrome.system.display.getInfo((displays) => {
            const display = displays[0] || {};
            const screen = display.workArea || { width: 1440, height: 900 };

            const setupJob = (w) => {
              if (!w || !w.tabs || w.tabs.length === 0) {
                sendLog(port, {
                  type: "ERROR",
                  message: "Failed to initialize job: Created window is inaccessible or has no tabs."
                });
                return;
              }
              const targetTabId = w.tabs[0].id;
              activeJobs.set(targetTabId, {
                port: port,
                actions: actions,
                currentIndex: 0,
                status: 'loading'
              });
              sendLog(port, {
                type: "INFO",
                message: `Dual Window Layout activated. Execution tab ID: ${targetTabId}.`
              });
            };

            const handlePostWindowCreate = (win) => {
              setupJob(win);
              // Shrink and pin the Vercel tab window to the right edge on top
              chrome.windows.update(vercelWindowId, {
                state: "normal",
                width: 450, // DevTools sidebar width
                height: screen.height - 100,
                left: screen.width - 480, // Pin to the right edge
                top: 50,
                focused: true // Keep logs focused and on top
              });
            };

            // Try opening in Incognito Mode maximized so target site gets full desktop layout
            chrome.windows.create({
              url: url,
              state: "maximized",
              incognito: true
            }, (targetWindow) => {
              const isError = chrome.runtime.lastError || !targetWindow || !targetWindow.tabs || targetWindow.tabs.length === 0;
              
              if (isError) {
                const errorMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Inaccessible window/tabs (enable 'Allow in Incognito' toggle in chrome://extensions)";
                sendLog(port, {
                  type: "INFO",
                  message: `Incognito setup bypassed: ${errorMsg}. Falling back to standard window.`
                });
                
                if (targetWindow && targetWindow.id) {
                  try {
                    chrome.windows.remove(targetWindow.id);
                  } catch (e) {}
                }

                chrome.windows.create({
                  url: url,
                  state: "maximized"
                }, (fallbackWindow) => {
                  handlePostWindowCreate(fallbackWindow);
                });
              } else {
                handlePostWindowCreate(targetWindow);
              }
            });
          });
        } else {
          // Fallback: Open target tab in the background
          const tab = await chrome.tabs.create({ url: url });
          activeJobs.set(tab.id, {
            port: port,
            actions: actions,
            currentIndex: 0,
            status: 'loading'
          });

          sendLog(port, {
            type: "INFO",
            message: `Opened target tab ID: ${tab.id}. Waiting for page load...`
          });
        }
      } catch (err) {
        sendLog(port, {
          type: "TEST_COMPLETE",
          status: "failure",
          message: `Failed to initialize split-screen workspace: ${err.message}`
        });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("Web app disconnected from extension.");
    // Find and clean up jobs associated with this disconnected port
    for (const [tabId, job] of activeJobs.entries()) {
      if (job.port === port) {
        activeJobs.delete(tabId);
      }
    }
  });
});

// Listen for tab updates (loading completes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const job = activeJobs.get(tabId);
  if (!job) return;

  if (changeInfo.status === 'complete') {
    console.log(`Tab ${tabId} loaded completely.`);
    if (job.status === 'loading') {
      job.status = 'executing';
      sendLog(job.port, {
        type: "INFO",
        message: `Page loaded completely. Running next step...`
      });
      // Add a slight delay to let SPA scripts initialize
      setTimeout(() => {
        runNextStep(tabId);
      }, 1000);
    }
  }
});

// Clean up jobs when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  const job = activeJobs.get(tabId);
  if (job) {
    sendLog(job.port, {
      type: "TEST_COMPLETE",
      status: "failure",
      message: "Target browser tab was closed by user."
    });
    activeJobs.delete(tabId);
  }
});

// Listen for helper messages (like verbose matching trace logs) from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "VERBOSE_LOG") {
    const tabId = sender.tab?.id;
    if (tabId) {
      const job = activeJobs.get(tabId);
      if (job && job.port) {
        sendLog(job.port, {
          type: "PROGRESS",
          message: request.message
        });
      }
    }
  }
});
