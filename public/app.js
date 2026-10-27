/**
 * DeliverIQ — Frontend Application Controller
 * Handles UI interactions, CSV parsing, verification queuing, live progress,
 * filtering, CSV export, and deep diagnostic inspection.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const tabPasteBtn = document.getElementById('tabPasteBtn');
  const tabUploadBtn = document.getElementById('tabUploadBtn');
  const pasteTabContent = document.getElementById('pasteTabContent');
  const uploadTabContent = document.getElementById('uploadTabContent');
  
  const emailInput = document.getElementById('emailInput');
  const detectedCount = document.getElementById('detectedCount');
  const sampleDataBtn = document.getElementById('sampleDataBtn');
  const clearInputBtn = document.getElementById('clearInputBtn');
  
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const filePreview = document.getElementById('filePreview');
  const fileNameEl = document.getElementById('fileName');
  const fileSizeEl = document.getElementById('fileSize');
  const fileStatsEl = document.getElementById('fileStats');
  const removeFileBtn = document.getElementById('removeFileBtn');
  
  const verifyBtn = document.getElementById('verifyBtn');
  const verifyBtnText = document.getElementById('verifyBtnText');
  const verifyBtnCount = document.getElementById('verifyBtnCount');
  
  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressCount = document.getElementById('progressCount');
  const progressPercent = document.getElementById('progressPercent');
  const currentCheckingEmail = document.getElementById('currentCheckingEmail');
  const elapsedTimer = document.getElementById('elapsedTimer');
  
  // KPI Elements
  const kpiTotal = document.getElementById('kpiTotal');
  const kpiDeliverable = document.getElementById('kpiDeliverable');
  const kpiDeliverablePct = document.getElementById('kpiDeliverablePct');
  const kpiBounce = document.getElementById('kpiBounce');
  const kpiBouncePct = document.getElementById('kpiBouncePct');
  const kpiUnknown = document.getElementById('kpiUnknown');
  const kpiUnknownPct = document.getElementById('kpiUnknownPct');
  const kpiAvgScore = document.getElementById('kpiAvgScore');
  const kpiRiskTier = document.getElementById('kpiRiskTier');
  
  // Filter & Table Elements
  const filterPills = document.querySelectorAll('.filter-pill');
  const badgeCountAll = document.getElementById('badgeCountAll');
  const badgeCountDeliverable = document.getElementById('badgeCountDeliverable');
  const badgeCountBounce = document.getElementById('badgeCountBounce');
  const badgeCountUnknown = document.getElementById('badgeCountUnknown');
  const tableSearchInput = document.getElementById('tableSearchInput');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const resultsTableBody = document.getElementById('resultsTableBody');
  const emptyStateRow = document.getElementById('emptyStateRow');
  const tableResultsCount = document.getElementById('tableResultsCount');
  
  // Modal Inspector Elements
  const inspectorModal = document.getElementById('inspectorModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalDoneBtn = document.getElementById('modalDoneBtn');
  const modalEmail = document.getElementById('modalEmail');
  const modalStatusBadge = document.getElementById('modalStatusBadge');
  const modalReason = document.getElementById('modalReason');
  const modalSyntax = document.getElementById('modalSyntax');
  const modalDisposable = document.getElementById('modalDisposable');
  const modalScore = document.getElementById('modalScore');
  const modalCatchAll = document.getElementById('modalCatchAll');
  const modalSpf = document.getElementById('modalSpf');
  const modalDmarc = document.getElementById('modalDmarc');
  const modalMxList = document.getElementById('modalMxList');
  const modalTranscript = document.getElementById('modalTranscript');

  // Export Modal Elements
  const exportModal = document.getElementById('exportModal');
  const closeExportModalBtn = document.getElementById('closeExportModalBtn');
  const cancelExportBtn = document.getElementById('cancelExportBtn');
  const confirmDownloadCsvBtn = document.getElementById('confirmDownloadCsvBtn');
  const copyCsvBtn = document.getElementById('copyCsvBtn');
  const exportTotalCount = document.getElementById('exportTotalCount');
  const exportDeliverableCount = document.getElementById('exportDeliverableCount');
  const exportBounceCount = document.getElementById('exportBounceCount');
  const exportUnknownCount = document.getElementById('exportUnknownCount');
  const exportCsvPreview = document.getElementById('exportCsvPreview');
  const exportTableContainer = document.getElementById('exportTableContainer');
  const exportTablePreviewBody = document.getElementById('exportTablePreviewBody');
  const exportViewTableBtn = document.getElementById('exportViewTableBtn');
  const exportViewRawBtn = document.getElementById('exportViewRawBtn');

  let currentExportCsvString = '';
  
  // Theme Toggle Elements
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeToggleLabel = document.getElementById('themeToggleLabel');

  function initTheme() {
    const savedTheme = localStorage.getItem('deliveriq-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'dark'); // default dark
    setTheme(initialTheme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('deliveriq-theme', theme);
    if (themeToggleLabel) {
      themeToggleLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
    });
  }

  initTheme();

  // State
  let currentActiveTab = 'PASTE'; // 'PASTE' | 'UPLOAD'
  let verifiedResults = [];
  let currentFilter = 'ALL';
  let uploadedFileEmails = [];
  let isProcessing = false;
  let timerInterval = null;
  let startTime = null;

  // Diverse Sample Demo Dataset (Generic scenarios: deliverable, bounce, unknown)
  const SAMPLE_EMAILS = [
    'alex.smith@gmail.com',
    'support@github.com',
    'contact@techcorp.org',
    'fakeuser@definitelydoesnotexist.xyz',
    'invalid-syntax@@format..com',
    'burner.user@10minutemail.com'
  ];

  // --- Tab Switching ---
  tabPasteBtn.addEventListener('click', () => {
    currentActiveTab = 'PASTE';
    tabPasteBtn.classList.add('active');
    tabUploadBtn.classList.remove('active');
    pasteTabContent.classList.add('active');
    uploadTabContent.classList.remove('active');
    updateDetectedCount();
  });

  tabUploadBtn.addEventListener('click', () => {
    currentActiveTab = 'UPLOAD';
    tabUploadBtn.classList.add('active');
    tabPasteBtn.classList.remove('active');
    uploadTabContent.classList.add('active');
    pasteTabContent.classList.remove('active');
    updateDetectedCount();
  });

  // --- Parse Emails from Textarea ---
  function extractEmails(text) {
    if (!text) return [];
    // Split by newlines, commas, semicolons, tabs, or spaces
    const tokens = text.split(/[\r\n,;\s]+/);
    const cleaned = [];
    const seen = new Set();

    for (let t of tokens) {
      t = t.trim();
      if (t.length > 0 && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        cleaned.push(t);
      }
    }
    return cleaned;
  }

  function updateDetectedCount() {
    let list = [];
    if (currentActiveTab === 'PASTE') {
      list = extractEmails(emailInput.value);
      detectedCount.textContent = `${list.length} address${list.length === 1 ? '' : 'es'} detected`;
    } else {
      list = uploadedFileEmails;
      detectedCount.textContent = `${list.length} address${list.length === 1 ? '' : 'es'} from file`;
    }

    if (list.length > 0) {
      verifyBtnCount.textContent = list.length;
      verifyBtnCount.classList.remove('hidden');
    } else {
      verifyBtnCount.classList.add('hidden');
    }
  }

  emailInput.addEventListener('input', updateDetectedCount);

  // --- Load Sample Data ---
  sampleDataBtn.addEventListener('click', () => {
    if (currentActiveTab !== 'PASTE') {
      tabPasteBtn.click();
    }
    emailInput.value = SAMPLE_EMAILS.join('\n');
    updateDetectedCount();
    emailInput.focus();
  });

  // --- Clear Input ---
  clearInputBtn.addEventListener('click', () => {
    emailInput.value = '';
    uploadedFileEmails = [];
    fileInput.value = '';
    filePreview.classList.add('hidden');
    updateDetectedCount();
  });

  // --- Drag and Drop File Upload ---
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value = '';
    uploadedFileEmails = [];
    filePreview.classList.add('hidden');
    updateDetectedCount();
  });

  function handleFileUpload(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      alert('Please upload a valid .csv or .txt file.');
      return;
    }

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    filePreview.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      uploadedFileEmails = parseFileContent(content, name.endsWith('.csv'));
      fileStatsEl.textContent = `Parsed ${uploadedFileEmails.length} unique emails ready for verification`;
      updateDetectedCount();
    };
    reader.readAsText(file);
  }

  function parseFileContent(content, isCsv) {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    const emails = [];
    const seen = new Set();

    if (isCsv && lines.length > 1) {
      // Check headers
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      let emailColIdx = headers.findIndex(h => h.includes('email') || h.includes('mail') || h === 'address');
      
      const startLine = emailColIdx !== -1 ? 1 : 0;
      if (emailColIdx === -1) emailColIdx = 0;

      for (let i = startLine; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        const candidate = cols[emailColIdx] || cols[0];
        if (candidate && !seen.has(candidate.toLowerCase())) {
          seen.add(candidate.toLowerCase());
          emails.push(candidate);
        }
      }
    } else {
      // Plain text or single column
      for (let line of lines) {
        const tokens = line.split(/[\s,;]+/);
        for (let t of tokens) {
          t = t.trim();
          if (t.length > 0 && !seen.has(t.toLowerCase())) {
            seen.add(t.toLowerCase());
            emails.push(t);
          }
        }
      }
    }
    return emails;
  }

  // --- Main Verification Engine Trigger ---
  verifyBtn.addEventListener('click', async () => {
    if (isProcessing) return;

    let targetEmails = currentActiveTab === 'PASTE' 
      ? extractEmails(emailInput.value) 
      : uploadedFileEmails;

    if (targetEmails.length === 0) {
      alert('Please enter or upload at least one email address to verify.');
      if (currentActiveTab === 'PASTE') emailInput.focus();
      return;
    }

    startVerification(targetEmails);
  });

  async function startVerification(emails) {
    isProcessing = true;
    verifyBtn.disabled = true;
    verifyBtnText.textContent = 'Verifying...';
    progressSection.classList.remove('hidden');

    verifiedResults = [];
    renderResultsTable(); // Clears previous results and shows loading state

    // Start Timer
    startTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      elapsedTimer.textContent = `Elapsed: ${elapsed}s`;
    }, 100);

    const total = emails.length;
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressCount.textContent = `0 / ${total}`;

    try {
      // Call backend API in concurrent worker batches
      const batchSize = 5;
      for (let i = 0; i < total; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        currentCheckingEmail.textContent = `Verifying: ${batch[0]} ${batch.length > 1 ? `(+${batch.length - 1} more)` : ''}`;

        // Dynamically resolve API URL (works whether served from Express, Live Server, or file://)
        const isCustomHost = window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000' && !window.location.hostname.includes('render.com') && !window.location.hostname.includes('railway.app'));
        const apiUrl = isCustomHost ? 'http://localhost:3000/api/verify' : '/api/verify';

        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: batch })
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          const data = await res.json();
          batchResults = data.results || [];
        } catch (err) {
          console.error('DeliverIQ Backend Connection Error:', err);
          alert(`⚠️ DeliverIQ Engine Error: Unable to connect to backend server at ${apiUrl}.\n\nPlease ensure your backend server is running in terminal with: npm run dev (or node server.js on port 3000).`);
          break;
        }

        verifiedResults.push(...batchResults);

        // Update progress
        const processed = verifiedResults.length;
        const pct = Math.round((processed / total) * 100);
        progressBar.style.width = `${pct}%`;
        progressPercent.textContent = `${pct}%`;
        progressCount.textContent = `${processed} / ${total}`;

        // Live update table and KPIs
        updateKpiDashboard();
        renderResultsTable();
      }

      currentCheckingEmail.textContent = `✅ Completed verification of ${total} address${total === 1 ? '' : 'es'}!`;
    } catch (error) {
      console.error('Verification error:', error);
      alert('An unexpected error occurred during verification. Please check console logs.');
    } finally {
      clearInterval(timerInterval);
      isProcessing = false;
      verifyBtn.disabled = false;
      verifyBtnText.textContent = 'Verify Emails';
      exportCsvBtn.disabled = verifiedResults.length === 0;
    }
  }

  // --- KPI Dashboard Calculations ---
  function updateKpiDashboard() {
    const total = verifiedResults.length;
    let deliverableCount = 0;
    let bounceCount = 0;
    let unknownCount = 0;
    let totalScore = 0;

    for (let r of verifiedResults) {
      const s = (r.status || '').toLowerCase();
      if (s.includes('deliver')) deliverableCount++;
      else if (s.includes('bounce')) bounceCount++;
      else unknownCount++;

      totalScore += (r.score || 0);
    }

    kpiTotal.textContent = total;
    badgeCountAll.textContent = total;

    kpiDeliverable.textContent = deliverableCount;
    badgeCountDeliverable.textContent = deliverableCount;
    kpiDeliverablePct.textContent = total > 0 ? `${Math.round((deliverableCount / total) * 100)}%` : '0%';

    kpiBounce.textContent = bounceCount;
    badgeCountBounce.textContent = bounceCount;
    kpiBouncePct.textContent = total > 0 ? `${Math.round((bounceCount / total) * 100)}%` : '0%';

    kpiUnknown.textContent = unknownCount;
    badgeCountUnknown.textContent = unknownCount;
    kpiUnknownPct.textContent = total > 0 ? `${Math.round((unknownCount / total) * 100)}%` : '0%';

    const avgScore = total > 0 ? Math.round(totalScore / total) : 0;
    kpiAvgScore.textContent = `${avgScore}%`;

    if (avgScore >= 80) {
      kpiRiskTier.textContent = 'Low Risk';
      kpiRiskTier.style.color = '#34d399';
    } else if (avgScore >= 45) {
      kpiRiskTier.textContent = 'Moderate';
      kpiRiskTier.style.color = '#fbbf24';
    } else {
      kpiRiskTier.textContent = 'High Risk';
      kpiRiskTier.style.color = '#fb7185';
    }
  }

  // --- Results Table Rendering & Filtering ---
  function renderResultsTable() {
    resultsTableBody.innerHTML = '';

    if (verifiedResults.length === 0) {
      resultsTableBody.appendChild(emptyStateRow);
      tableResultsCount.textContent = 'Showing 0 results';
      return;
    }

    const searchKeyword = tableSearchInput.value.toLowerCase().trim();

    const filtered = verifiedResults.filter(r => {
      // Status Filter
      const s = (r.status || '').toLowerCase();
      let matchesFilter = true;
      if (currentFilter === 'DELIVERABLE') matchesFilter = s.includes('deliver');
      else if (currentFilter === 'BOUNCE') matchesFilter = s.includes('bounce');
      else if (currentFilter === 'UNKNOWN') matchesFilter = s.includes('unknown');

      // Search Filter
      let matchesSearch = true;
      if (searchKeyword.length > 0) {
        matchesSearch = r.email.toLowerCase().includes(searchKeyword) ||
                        (r.reason || '').toLowerCase().includes(searchKeyword) ||
                        (r.mxRecords && r.mxRecords.join(' ').toLowerCase().includes(searchKeyword));
      }

      return matchesFilter && matchesSearch;
    });

    tableResultsCount.textContent = `Showing ${filtered.length} of ${verifiedResults.length} results`;

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="7" style="text-align: center; padding: 32px; color: var(--text-dim);">
          No emails match the selected filter.
        </td>
      `;
      resultsTableBody.appendChild(tr);
      return;
    }

    filtered.forEach((r, idx) => {
      const tr = document.createElement('tr');
      
      // Determine Status Badge & Colors
      const s = (r.status || '').toLowerCase();
      let statusClass = 'status-unknown';
      let statusIcon = '🟡';
      let scoreClass = 'score-bar-unknown';

      if (s.includes('deliver')) {
        statusClass = 'status-deliverable';
        statusIcon = '🟢';
        scoreClass = 'score-bar-deliverable';
      } else if (s.includes('bounce')) {
        statusClass = 'status-bounce';
        statusIcon = '🔴';
        scoreClass = 'score-bar-bounce';
      }

      const primaryMx = (r.mxRecords && r.mxRecords.length > 0) ? r.mxRecords[0] : 'None';
      const score = typeof r.score === 'number' ? r.score : 50;

      tr.innerHTML = `
        <td class="col-num">${idx + 1}</td>
        <td class="col-email">
          <span class="email-display" title="${escapeHtml(r.email)}">${escapeHtml(r.email)}</span>
        </td>
        <td class="col-status">
          <span class="status-badge ${statusClass}">
            ${statusIcon} ${r.status}
          </span>
        </td>
        <td class="col-score">
          <div class="score-cell">
            <div class="score-bar-bg">
              <div class="score-bar-fill ${scoreClass}" style="width: ${score}%"></div>
            </div>
            <span class="score-text">${score}%</span>
          </div>
        </td>
        <td class="col-mx">
          <div class="mx-cell" title="${escapeHtml(primaryMx)}">${escapeHtml(primaryMx)}</div>
        </td>
        <td class="col-reason">
          <div class="reason-text">${escapeHtml(r.reason || 'Evaluation complete')}</div>
        </td>
        <td class="col-action">
          <button class="inspect-btn" data-email="${escapeHtml(r.email)}" type="button">
            🔍 Inspect
          </button>
        </td>
      `;

      // Click to open modal
      tr.addEventListener('click', (e) => {
        // Prevent if clicking on other action
        openInspectorModal(r);
      });

      resultsTableBody.appendChild(tr);
    });
  }

  // --- Filter Pill Listeners ---
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter');
      renderResultsTable();
    });
  });

  // --- Live Search Listener ---
  tableSearchInput.addEventListener('input', () => {
    renderResultsTable();
  });

  // --- Modal Inspector ---
  function openInspectorModal(record) {
    modalEmail.textContent = record.email;
    
    // Status Badge
    const s = (record.status || '').toLowerCase();
    modalStatusBadge.className = 'status-badge';
    if (s.includes('deliver')) {
      modalStatusBadge.classList.add('status-deliverable');
      modalStatusBadge.textContent = '🟢 Likely to be delivered';
    } else if (s.includes('bounce')) {
      modalStatusBadge.classList.add('status-bounce');
      modalStatusBadge.textContent = '🔴 Likely to bounce';
    } else {
      modalStatusBadge.classList.add('status-unknown');
      modalStatusBadge.textContent = '🟡 Unknown (Catch-all / Host Port 25 restriction)';
    }

    modalSyntax.textContent = record.syntax !== false ? '✅ RFC 5322 Valid' : '❌ Syntax Error';
    modalDisposable.textContent = record.disposable ? '❌ Disposable Burner Domain' : '✅ Legitimate Domain';
    modalScore.textContent = `${record.score || 0}%`;
    modalCatchAll.textContent = record.isCatchAll ? '⚠️ Detected (Accepts all)' : '✅ Not Catch-All';
    modalSpf.textContent = record.spf ? '✅ Configured (Protected)' : '⚠️ Not Detected';
    modalDmarc.textContent = record.dmarc ? '✅ Configured (Protected)' : '⚠️ Not Detected';

    // Diagnostic Assessment Reason
    if (modalReason) {
      modalReason.textContent = record.reason || 'Verification evaluation completed.';
      modalReason.className = 'diagnostic-reason-callout';
      const rLower = (record.reason || '').toLowerCase();
      const sLower = (record.status || '').toLowerCase();
      if (rLower.includes('blocked') || rLower.includes('restriction') || rLower.includes('timed out') || rLower.includes('catch-all') || sLower.includes('unknown')) {
        modalReason.classList.add('reason-blocked');
      } else if (sLower.includes('bounce') || rLower.includes('bounce') || rLower.includes('not exist') || rLower.includes('rejected')) {
        modalReason.classList.add('reason-bounce');
      } else if (sLower.includes('deliver') || rLower.includes('active') || rLower.includes('exists')) {
        modalReason.classList.add('reason-deliverable');
      }
    }

    // MX Records
    modalMxList.innerHTML = '';
    if (record.mxRecords && record.mxRecords.length > 0) {
      record.mxRecords.forEach((mx, i) => {
        const span = document.createElement('span');
        span.className = 'mx-pill';
        span.textContent = `[${i + 1}] ${mx}`;
        modalMxList.appendChild(span);
      });
    } else {
      modalMxList.innerHTML = '<span style="color: var(--text-dim); font-size: 0.8rem;">No MX records configured</span>';
    }

    // Transcript
    if (record.transcript && Array.isArray(record.transcript)) {
      modalTranscript.textContent = record.transcript.join('\n');
    } else {
      modalTranscript.textContent = record.reason || 'Verification process completed.';
    }

    inspectorModal.classList.remove('hidden');
  }

  function closeModal() {
    inspectorModal.classList.add('hidden');
  }

  closeModalBtn.addEventListener('click', closeModal);
  modalDoneBtn.addEventListener('click', closeModal);
  inspectorModal.addEventListener('click', (e) => {
    if (e.target === inspectorModal) closeModal();
  });

  // --- Export to CSV Flow (Preview First, Then Download) ---
  function openExportModal() {
    if (verifiedResults.length === 0) return;

    const headers = ['Email', 'Status', 'Deliverability Score (%)', 'Primary Reason', 'Primary MX Host', 'SPF Authenticated', 'DMARC Configured', 'Disposable Domain', 'Timestamp'];
    const rows = [headers.join(',')];

    let deliverableCount = 0;
    let bounceCount = 0;
    let unknownCount = 0;

    for (let r of verifiedResults) {
      const primaryMx = (r.mxRecords && r.mxRecords.length > 0) ? r.mxRecords[0] : 'None';
      const row = [
        `"${cleanCsv(r.email)}"`,
        `"${cleanCsv(r.status)}"`,
        r.score || 0,
        `"${cleanCsv(r.reason || '')}"`,
        `"${cleanCsv(primaryMx)}"`,
        r.spf ? 'TRUE' : 'FALSE',
        r.dmarc ? 'TRUE' : 'FALSE',
        r.disposable ? 'TRUE' : 'FALSE',
        `"${new Date().toISOString()}"`
      ];
      rows.push(row.join(','));

      const st = (r.status || '').toLowerCase();
      if (st.includes('deliver')) deliverableCount++;
      else if (st.includes('bounce')) bounceCount++;
      else unknownCount++;
    }

    currentExportCsvString = rows.join('\r\n');

    // Update stats in modal
    if (exportTotalCount) exportTotalCount.textContent = verifiedResults.length;
    if (exportDeliverableCount) exportDeliverableCount.textContent = deliverableCount;
    if (exportBounceCount) exportBounceCount.textContent = bounceCount;
    if (exportUnknownCount) exportUnknownCount.textContent = unknownCount;

    // Populate Spreadsheet Table Preview
    if (exportTablePreviewBody) {
      exportTablePreviewBody.innerHTML = '';
      const previewRecords = verifiedResults.slice(0, 10);
      previewRecords.forEach((r, idx) => {
        const tr = document.createElement('tr');
        const primaryMx = (r.mxRecords && r.mxRecords.length > 0) ? r.mxRecords[0] : 'None';
        const st = (r.status || '').toLowerCase();
        let statusBadge = '<span class="status-badge status-unknown">🟡 Unknown</span>';
        if (st.includes('deliver')) {
          statusBadge = '<span class="status-badge status-deliverable">🟢 Deliverable</span>';
        } else if (st.includes('bounce')) {
          statusBadge = '<span class="status-badge status-bounce">🔴 Bounce</span>';
        }

        tr.innerHTML = `
          <td class="cell-idx">${idx + 1}</td>
          <td class="cell-email" title="${escapeHtml(r.email)}">${escapeHtml(r.email)}</td>
          <td>${statusBadge}</td>
          <td><strong>${r.score || 0}%</strong></td>
          <td class="cell-reason" title="${escapeHtml(r.reason || '')}">${escapeHtml(r.reason || 'N/A')}</td>
          <td class="cell-mx" title="${escapeHtml(primaryMx)}">${escapeHtml(primaryMx)}</td>
          <td><span class="cell-bool ${r.spf ? 'true-val' : 'false-val'}">${r.spf ? 'TRUE' : 'FALSE'}</span></td>
          <td><span class="cell-bool ${r.dmarc ? 'true-val' : 'false-val'}">${r.dmarc ? 'TRUE' : 'FALSE'}</span></td>
          <td><span class="cell-bool ${r.disposable ? 'false-val' : 'true-val'}">${r.disposable ? 'TRUE' : 'FALSE'}</span></td>
          <td class="cell-idx">${new Date().toISOString().slice(0, 19).replace('T', ' ')}</td>
        `;
        exportTablePreviewBody.appendChild(tr);
      });
    }

    // Populate Raw CSV Preview
    if (exportCsvPreview) {
      const previewRows = rows.slice(0, 11).join('\n');
      const remaining = rows.length - 11;
      exportCsvPreview.textContent = remaining > 0 
        ? `${previewRows}\n\n... and ${remaining} more records (ready in full download)`
        : previewRows;
    }

    // Default to Table Spreadsheet View
    if (exportTableContainer && exportCsvPreview) {
      exportTableContainer.classList.remove('hidden');
      exportCsvPreview.classList.add('hidden');
      if (exportViewTableBtn) exportViewTableBtn.classList.add('active');
      if (exportViewRawBtn) exportViewRawBtn.classList.remove('active');
    }

    exportModal.classList.remove('hidden');
  }

  function closeExportModal() {
    exportModal.classList.add('hidden');
  }

  // View Switchers: Spreadsheet Table vs Raw CSV
  if (exportViewTableBtn && exportViewRawBtn) {
    exportViewTableBtn.addEventListener('click', () => {
      exportViewTableBtn.classList.add('active');
      exportViewRawBtn.classList.remove('active');
      if (exportTableContainer) exportTableContainer.classList.remove('hidden');
      if (exportCsvPreview) exportCsvPreview.classList.add('hidden');
    });

    exportViewRawBtn.addEventListener('click', () => {
      exportViewRawBtn.classList.add('active');
      exportViewTableBtn.classList.remove('active');
      if (exportCsvPreview) exportCsvPreview.classList.remove('hidden');
      if (exportTableContainer) exportTableContainer.classList.add('hidden');
    });
  }

  exportCsvBtn.addEventListener('click', openExportModal);
  closeExportModalBtn.addEventListener('click', closeExportModal);
  cancelExportBtn.addEventListener('click', closeExportModal);

  exportModal.addEventListener('click', (e) => {
    if (e.target === exportModal) closeExportModal();
  });

  // Copy CSV Content to Clipboard
  copyCsvBtn.addEventListener('click', () => {
    if (!currentExportCsvString) return;
    navigator.clipboard.writeText(currentExportCsvString).then(() => {
      const origHtml = copyCsvBtn.innerHTML;
      copyCsvBtn.innerHTML = '✅ Copied to Clipboard!';
      copyCsvBtn.style.color = '#10b981';
      setTimeout(() => {
        copyCsvBtn.innerHTML = origHtml;
        copyCsvBtn.style.color = '';
      }, 2000);
    }).catch(() => {
      copyCsvBtn.textContent = '❌ Copy Failed';
    });
  });

  // Confirm Download Button -> Triggers actual .csv download
  confirmDownloadCsvBtn.addEventListener('click', () => {
    if (!currentExportCsvString) return;

    const blob = new Blob([currentExportCsvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `deliveriq-verified-list-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    closeExportModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!inspectorModal.classList.contains('hidden')) closeModal();
      if (!exportModal.classList.contains('hidden')) closeExportModal();
    }
  });

  function cleanCsv(str) {
    if (!str) return '';
    return str.toString().replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
