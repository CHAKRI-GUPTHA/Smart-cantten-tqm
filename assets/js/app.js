(() => {
  "use strict";

  let complaints = [
    { id: "SC-1042", date: "Oct 20", category: "Taste", description: "Food taste is not good", priority: "High", assigned: "Unassigned", status: "Open" },
    { id: "SC-1041", date: "Oct 19", category: "Waiting time", description: "Long waiting time at lunch", priority: "Medium", assigned: "Jordan T.", status: "In Progress" },
    { id: "SC-1040", date: "Oct 18", category: "Cleanliness", description: "Cleanliness issue near tables", priority: "High", assigned: "Sam R.", status: "Resolved" },
    { id: "SC-1039", date: "Oct 18", category: "Portion size", description: "Portion size is small", priority: "Low", assigned: "Unassigned", status: "Resolved" },
    { id: "SC-1038", date: "Oct 17", category: "Waiting time", description: "Queue moved slowly", priority: "Medium", assigned: "Jordan T.", status: "Open" },
    { id: "SC-1037", date: "Oct 16", category: "Other", description: "Menu item unavailable", priority: "Low", assigned: "Unassigned", status: "Open" }
  ];
  let feedback = [
    { name: "Priya S.", initials: "PS", meal: "Lunch", rating: 5, date: "Today, 12:42 PM", comment: "Fresh meals and a much faster lunch queue this week." },
    { name: "Arjun K.", initials: "AK", meal: "Breakfast", rating: 4, date: "Today, 9:18 AM", comment: "Loved the breakfast today. The dining area was clean too." },
    { name: "Maya R.", initials: "MR", meal: "Lunch", rating: 3, date: "Yesterday, 1:05 PM", comment: "Food was good, though the queue got long around 1 PM." }
  ];
  const history = [];
  let feedbackCount = 320;
  let feedbackRatingTotal = 1376;
  let nextComplaint = 1043;
  let foodScore = 92;
  let hygieneScore = 88;
  let complaintLabels = ["Taste", "Waiting time", "Cleanliness", "Portion size", "Other"];
  let complaintCounts = [32, 24, 18, 12, 7];
  let backendEnabled = false;
  let activeUser = null;
  const foodCriteria = ["Food freshness", "Taste", "Serving temperature", "Portion size", "Presentation", "Ingredient quality", "Storage conditions"];
  const hygieneCriteria = ["Dining area cleanliness", "Tables and chairs", "Kitchen cleanliness", "Handwashing facilities", "Waste disposal", "Pest control", "Food storage", "Staff hygiene"];
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  async function apiRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `The server returned HTTP ${response.status} instead of an API response. This app needs its Flask backend; GitHub Pages only serves static files and cannot handle sign-in or sign-out.`
      );
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `The request failed (HTTP ${response.status}).`);
    return result;
  }
  function asDateLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }
  function renderDoughnut(id, labels, values, palette) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    new Chart(canvas, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: palette, borderWidth: 2, borderColor: "#fff", hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 11, font: { size: 8 } } } } }
    });
  }

  function iconRefresh() {
    if (window.lucide) window.lucide.createIcons();
  }
  function notify(message, student = false) {
    const region = document.getElementById(student ? "toastRegion" : "adminToastRegion");
    if (!region) return;
    region.innerHTML = `<div class="toast-message">${escapeHtml(message)}</div>`;
    region.classList.add("show");
    window.clearTimeout(region._timer);
    region._timer = window.setTimeout(() => region.classList.remove("show"), 3300);
  }
  function showModal(title, message) {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalContent").innerHTML = `<p>${escapeHtml(message)}</p>`;
    document.getElementById("modalBackdrop").hidden = false;
    iconRefresh();
  }
  function closeModal() {
    document.getElementById("modalBackdrop").hidden = true;
  }
  function showAdminView(name) {
    const target = document.getElementById(`view-${name}`);
    if (!target) return;
    document.querySelectorAll(".view-panel").forEach(panel => panel.classList.toggle("active", panel === target));
    document.querySelectorAll(".nav-link[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === name));
    const title = document.querySelector(`.nav-link[data-view="${name}"] span:nth-child(2)`);
    document.getElementById("breadcrumbTitle").textContent = title ? title.textContent : "Dashboard";
    document.getElementById("sidebar").classList.remove("mobile-open");
    if (name === "analysis") {
      renderPareto("paretoAnalysisChart");
      if (backendEnabled) loadTqmData().catch(error => notify(`Unable to load TQM analysis: ${error.message}`));
    }
    if (name === "improvements" && backendEnabled) loadTqmData().catch(error => notify(`Unable to load improvement plans: ${error.message}`));
    if (name === "staff" && backendEnabled) loadStaffData().catch(error => notify(`Unable to load staff tasks: ${error.message}`));
    if (name === "food-quality" && backendEnabled) loadInspectionHistory("food").catch(error => notify(`Unable to load food inspection history: ${error.message}`));
    if (name === "hygiene" && backendEnabled) loadInspectionHistory("hygiene").catch(error => notify(`Unable to load hygiene inspection history: ${error.message}`));
    if (name === "complaints") renderComplaints();
    if (name === "feedback") renderFeedback();
    if (backendEnabled) loadManagerData().catch(error => notify(`Unable to refresh data: ${error.message}`));
    window.scrollTo({ top: 0, behavior: "smooth" });
    iconRefresh();
  }
  function showStudentApp(view = "home") {
    document.getElementById("adminApp").hidden = true;
    document.getElementById("studentApp").hidden = false;
    showStudentView(view);
    if (backendEnabled && activeUser?.role !== "Student") notify("Student app preview only. Sign in with a Student account to submit feedback or complaints.", true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function navigateApp(mode, view = "home", addHistory = true) {
    const url = new URL(window.location.href);
    if (mode === "student") url.searchParams.set("app", "student");
    else url.searchParams.delete("app");
    if (addHistory) window.history.pushState({ app: mode }, "", url);
    showApp(mode, view);
  }
  function showApp(mode, view = "home") {
    if (mode === "student") {
      showStudentApp(view);
      return;
    }
    document.getElementById("studentApp").hidden = true;
    document.getElementById("adminApp").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showStudentView(name) {
    const target = document.getElementById(`student-${name}`);
    if (!target) return;
    document.querySelectorAll(".student-view").forEach(panel => panel.classList.toggle("active", panel === target));
    document.querySelectorAll(".student-tab").forEach(button => button.classList.toggle("active", button.dataset.studentView === name));
    if (name === "history") {
      renderHistory();
      if (backendEnabled && activeUser?.role === "Student") loadStudentData().catch(error => notify(`Unable to refresh history: ${error.message}`, true));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    iconRefresh();
  }
  function statusClass(status) {
    return status.toLowerCase().replaceAll(" ", "-");
  }
  function renderComplaintRows() {
    const category = document.getElementById("categoryFilter")?.value || "all";
    const status = document.getElementById("statusFilter")?.value || "all";
    const priority = document.getElementById("priorityFilter")?.value || "all";
    const start = document.getElementById("complaintDateStart")?.value || "";
    const end = document.getElementById("complaintDateEnd")?.value || "";
    const filtered = complaints.filter(item => (category === "all" || item.category === category) && (status === "all" || item.status === status) && (priority === "all" || item.priority === priority) && (!start || !item.isoDate || item.isoDate >= start) && (!end || !item.isoDate || item.isoDate <= end));
    const tbody = document.getElementById("complaintTableRows");
    if (tbody) {
      tbody.innerHTML = filtered.map(item => `<tr><td><strong>${escapeHtml(item.id)}</strong></td><td>${escapeHtml(item.date)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.description)}</td><td><span class="priority priority-${item.priority.toLowerCase()}">${escapeHtml(item.priority)}</span></td><td>${escapeHtml(item.assigned)}</td><td><span class="status-chip status-${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><button class="table-action" data-complaint-action="${escapeHtml(item.id)}">Open</button></td></tr>`).join("") || `<tr><td colspan="8">No complaints match these filters.</td></tr>`;
    }
  }
  async function loadManagerData() {
    const [dashboard, complaintData, feedbackData] = await Promise.all([
      apiRequest(`/api/dashboard?days=${document.getElementById("trendRange").value === "Last 30 Days" ? "30" : "7"}`),
      apiRequest("/api/complaints"),
      apiRequest("/api/feedback")
    ]);
    complaints = complaintData.items.map(item => ({
      id: item.id, date: asDateLabel(item.created_at), isoDate: item.created_at?.slice(0, 10), category: item.category, description: item.description,
      priority: item.priority, assigned: item.assigned_staff || "Unassigned", status: item.status, resolution: item.resolution
    }));
    feedback = feedbackData.items.map(item => ({
      name: "Student", initials: "ST", meal: item.meal, rating: item.overall_rating,
      date: asDateLabel(item.created_at), comment: item.comments || "No written comment."
    }));
    feedbackCount = dashboard.feedback_count;
    feedbackRatingTotal = (dashboard.satisfaction || 0) * dashboard.feedback_count;
    document.getElementById("foodScore").textContent = dashboard.food_quality_score ?? "—";
    document.getElementById("foodScorePage").textContent = dashboard.food_quality_score ?? "—";
    document.getElementById("hygieneScore").textContent = dashboard.hygiene_score ?? "—";
    document.getElementById("satisfactionScore").textContent = dashboard.satisfaction ?? "—";
    document.getElementById("averageServiceTime").textContent = dashboard.average_service_time ?? "—";
    document.getElementById("serviceTimeCount").textContent = dashboard.service_time_count;
    document.getElementById("feedbackTotal").textContent = dashboard.feedback_count;
    document.getElementById("feedbackMetric").textContent = dashboard.feedback_count;
    document.getElementById("feedbackAverage").textContent = dashboard.satisfaction ?? "—";
    document.getElementById("openComplaints").textContent = dashboard.complaints_open;
    document.getElementById("openComplaintMetric").textContent = dashboard.complaint_status?.Open || 0;
    document.getElementById("inProgressComplaintMetric").textContent = dashboard.complaint_status?.["In Progress"] || 0;
    document.getElementById("resolvedComplaintMetric").textContent = dashboard.complaint_status?.Resolved || 0;
    document.getElementById("totalComplaints").textContent = dashboard.complaints_total;
    document.getElementById("feedbackNavCount").textContent = dashboard.feedback_count;
    document.getElementById("complaintNavCount").textContent = dashboard.complaints_open;
    if (dashboard.food_quality_score !== null) document.getElementById("foodScoreBar").style.width = `${dashboard.food_quality_score}%`;
    if (dashboard.hygiene_score !== null) document.getElementById("hygieneScoreBar").style.width = `${dashboard.hygiene_score}%`;
    document.getElementById("voiceRating").textContent = dashboard.satisfaction ?? "—";
    document.getElementById("voiceCount").textContent = dashboard.feedback_count;
    document.getElementById("voiceQuote").innerHTML = feedback[0] ? `“${escapeHtml(feedback[0].comment)}” <small>— Student feedback · ${escapeHtml(feedback[0].date)}</small>` : "No student comments yet.";
    if (dashboard.food_quality_score !== null) document.getElementById("foodSummaryStatus").textContent = `${dashboard.food_quality_score}% score`;
    if (dashboard.hygiene_score !== null) document.getElementById("hygieneSummaryStatus").textContent = `${dashboard.hygiene_score}% compliant`;
    document.querySelectorAll(".demo-pill").forEach(pill => {
      pill.textContent = dashboard.demo_mode ? "DEMO + LIVE DATA" : "LIVE DATA";
    });
    complaintLabels = dashboard.complaint_categories.map(item => item.category);
    complaintCounts = dashboard.complaint_categories.map(item => item.count);
    renderRecentComplaints();
    renderComplaintRows();
    renderFeedback();
    refreshFeedbackMetrics();
    renderPareto("paretoChart");
    const foodDistribution = dashboard.food_quality_distribution || {};
    renderDoughnut("foodDistributionChart", Object.keys(foodDistribution), Object.values(foodDistribution), ["#2bb77b", "#f4b43e", "#ef6671"]);
    const hygieneDistribution = dashboard.hygiene_performance || {};
    renderDoughnut("hygieneDistributionChart", Object.keys(hygieneDistribution), Object.values(hygieneDistribution), ["#3981ef", "#f4b43e", "#ef6671"]);
    const statuses = ["Open", "In Progress", "Resolved"];
    renderDoughnut("complaintStatusChart", statuses, statuses.map(status => dashboard.complaint_status[status] || 0), ["#f36572", "#f4b641", "#44c98a"]);
    const trend = window.Chart ? Chart.getChart("satisfactionChart") : null;
    if (trend && dashboard.satisfaction_trend.length) {
      trend.data.labels = dashboard.satisfaction_trend.map(item => asDateLabel(item.day));
      trend.data.datasets[0].data = dashboard.satisfaction_trend.map(item => item.average);
      trend.update();
    }
  }
  async function loadStudentData() {
    const [feedbackData, complaintData, menuData, summary] = await Promise.all([
      apiRequest("/api/feedback/mine"),
      apiRequest("/api/complaints/mine"),
      apiRequest("/api/menu"),
      apiRequest("/api/student/summary")
    ]);
    history.splice(0, history.length,
      ...feedbackData.items.map(item => ({
        type: "feedback", meal: item.meal, rating: item.overall_rating, date: asDateLabel(item.created_at),
        summary: item.comments || "Thanks for sharing your meal rating."
      })),
      ...complaintData.items.map(item => ({
        type: "complaint", id: item.id, status: item.status, date: asDateLabel(item.created_at),
        summary: `${item.category} · ${item.description}`
      }))
    );
    const mealHours = { Breakfast: "7:30 – 10:00 AM", Lunch: "12:00 – 2:30 PM", Snacks: "3:30 – 5:30 PM", Dinner: "7:00 – 9:00 PM" };
    const mealIcons = { Breakfast: "sunrise", Lunch: "sun", Snacks: "coffee", Dinner: "moon" };
    const grouped = Object.groupBy ? Object.groupBy(menuData.items, item => item.meal) : menuData.items.reduce((groups, item) => {
      (groups[item.meal] ||= []).push(item);
      return groups;
    }, {});
    document.getElementById("studentMenuRecords").innerHTML = Object.keys(mealHours).map(meal => {
      const entries = grouped[meal] || [];
      return `<article class="student-card menu-section"><div class="menu-time"><i data-lucide="${mealIcons[meal]}"></i><span><strong>${meal}</strong><small>${mealHours[meal]}</small></span></div>${entries.map(item => `<div class="menu-dish"><span class="dish-emoji">🍽️</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></div><span class="dish-price">₹${Number(item.price).toFixed(0)}</span></div>`).join("") || `<p class="menu-empty">Menu not published yet.</p>`}</article>`;
    }).join("");
    const lunch = grouped.Lunch || [];
    const todayCard = document.getElementById("todayMenuCard");
    const lunchDescription = todayCard.querySelector("p");
    const firstLunch = lunch[0];
    if (firstLunch) {
      todayCard.querySelector("h2").textContent = firstLunch.name;
      lunchDescription.textContent = [firstLunch.description, ...lunch.slice(1, 3).map(item => item.name)].filter(Boolean).join(" · ");
    }
    if (summary.food_quality_score !== null) document.getElementById("studentFoodScore").textContent = summary.food_quality_score;
    if (summary.hygiene_score !== null) document.getElementById("studentHygieneScore").textContent = summary.hygiene_score;
    if (summary.satisfaction !== null) document.querySelector(".rating-top h2").innerHTML = `${Number(summary.satisfaction).toFixed(1)} <small>/ 5</small>`;
    if (summary.latest_complaint) {
      document.getElementById("studentComplaintSummary").textContent = `${summary.latest_complaint.id} · ${summary.latest_complaint.status}`;
      document.getElementById("studentComplaintDetail").textContent = `${summary.latest_complaint.category} · tap to view progress`;
    }
    renderHistory();
    iconRefresh();
  }
  function renderImprovementPlans(plans) {
    const container = document.getElementById("improvementPlans");
    if (!container) return;
    container.innerHTML = plans.map(plan => {
      const order = ["Plan", "Do", "Check", "Act"];
      const current = order.indexOf(plan.stage);
      const canEdit = activeUser && ["Admin", "Manager"].includes(activeUser.role);
      return `<article class="panel improvement-card"><div class="improvement-top"><span class="status-chip ${plan.status === "Completed" ? "status-good" : "status-in-progress"}">${escapeHtml(plan.status)}</span><span class="plan-id">PLAN · ${String(plan.id).padStart(3, "0")}</span></div><h2>${escapeHtml(plan.title)}</h2><p>${escapeHtml(plan.problem)} · Target: ${escapeHtml(plan.target)}</p><div class="plan-owner">Due ${escapeHtml(plan.due_date || "Not set")}</div><div class="plan-progress"><span>${plan.progress}% complete</span><div class="progress-track"><i style="width:${plan.progress}%"></i></div></div><div class="plan-steps">${order.map((stage, index) => `<span class="${index < current ? "done" : index === current ? "current" : ""}">${stage}</span>`).join("")}</div>${canEdit ? `<button class="button button-outline plan-open" data-plan="${plan.id}" data-stage="${escapeHtml(plan.stage)}" data-progress="${plan.progress}">Advance PDCA step</button>` : ""}</article>`;
    }).join("") || `<article class="panel empty-state">No improvement plans yet. Create one to start a PDCA cycle.</article>`;
  }
  async function loadTqmData() {
    const [data, control] = await Promise.all([
      apiRequest("/api/tqm"),
      apiRequest(`/api/tqm/control-chart?metric=${encodeURIComponent(document.getElementById("controlMetric").value)}`)
    ]);
    renderImprovementPlans(data.improvement_plans);
    document.getElementById("checkSheet").innerHTML = data.check_sheet.map(item => `<div><span>${escapeHtml(item.item_name)} · ${escapeHtml(item.status)}</span><strong>${item.count}</strong></div>`).join("") || `<div><span>No inspection defects recorded</span><strong>0</strong></div>`;
    document.getElementById("fishboneRecords").innerHTML = data.fishbone_causes.map(item => `<span class="fishbone-tag"><b>${escapeHtml(item.category)}</b>${escapeHtml(item.cause)}</span>`).join("");
    document.getElementById("savedWhys").innerHTML = data.five_whys.slice(0, 3).map(item => `<article><strong>${escapeHtml(item.problem)}</strong><ol>${item.whys.map(why => `<li>${escapeHtml(why)}</li>`).join("")}</ol><small>Root cause: ${escapeHtml(item.root_cause || "Not recorded")}</small></article>`).join("");
    const whyContainer = document.getElementById("whyFields");
    if (data.five_whys.length) {
      whyContainer.dataset.saved = JSON.stringify(data.five_whys.slice(0, 5));
      whyContainer.title = `Latest saved problem: ${data.five_whys[0].problem}; root cause: ${data.five_whys[0].root_cause || "not recorded"}`;
    }
    document.getElementById("controlExplanation").textContent = control.sufficient_data
      ? `${control.observations} observations. Center ${control.center_line}; limits ${control.lower_control_limit}–${control.upper_control_limit}. ${control.explanation}`
      : `${control.observations} observations. ${control.explanation}`;
    if (window.Chart) {
      const canvas = document.getElementById("controlChart");
      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
      new Chart(canvas, {
        type: "line",
        data: { labels: control.points.map(point => asDateLabel(point.day)), datasets: [
          { label: "Observed", data: control.points.map(point => point.value), borderColor: "#5865f2", backgroundColor: "rgba(94,103,246,.10)", fill: false, tension: .2, pointRadius: 3 },
          ...(control.sufficient_data ? [
            { label: "Center", data: control.points.map(() => control.center_line), borderColor: "#24af73", borderDash: [4, 4], pointRadius: 0 },
            { label: "UCL", data: control.points.map(() => control.upper_control_limit), borderColor: "#e46b73", borderDash: [4, 4], pointRadius: 0 },
            { label: "LCL", data: control.points.map(() => control.lower_control_limit), borderColor: "#e46b73", borderDash: [4, 4], pointRadius: 0 }
          ] : [])
        ] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, font: { size: 8 } } } }, scales: { y: { min: document.getElementById("controlMetric").value === "overall_rating" ? 1 : 0, max: document.getElementById("controlMetric").value === "overall_rating" ? 5 : 100, grid: { color: "#f0f2f6" } }, x: { grid: { display: false } } } }
      });
    }
  }
  async function loadStaffData() {
    const [staffData, actionsData] = await Promise.all([apiRequest("/api/staff"), apiRequest("/api/corrective-actions")]);
    document.getElementById("staffList").innerHTML = staffData.items.map(item => `<div class="staff-list-row"><span class="avatar avatar-small">${escapeHtml(item.name.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.position)} · ${item.completed_tasks}/${item.assigned_tasks} tasks complete</small></div><span>${item.active ? "Active" : "Inactive"}</span></div>`).join("");
    document.getElementById("taskStaffSelect").innerHTML = `<option value="">Unassigned</option>${staffData.items.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
    document.getElementById("taskList").innerHTML = actionsData.items.map(item => `<div class="staff-list-row" data-task-id="${item.id}"><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.assigned_staff || "Unassigned")} · Due ${escapeHtml(item.due_date || "No deadline")}</small></div><select class="task-status" aria-label="Task status"><option ${item.status === "Open" ? "selected" : ""}>Open</option><option ${item.status === "In Progress" ? "selected" : ""}>In Progress</option><option ${item.status === "Completed" ? "selected" : ""}>Completed</option></select></div>`).join("") || `<div class="staff-list-row">No corrective-action tasks.</div>`;
  }
  async function loadInspectionHistory(kind) {
    const data = await apiRequest(`/api/inspections/${kind}`);
    const container = document.getElementById(`${kind}InspectionHistory`);
    container.innerHTML = data.items.length ? `<table class="full-table"><thead><tr><th>Date</th>${kind === "food" ? "<th>Meal</th>" : ""}<th>Inspector</th><th>Score</th><th>Checklist findings</th><th>Remarks</th></tr></thead><tbody>${data.items.map(item => `<tr><td>${escapeHtml(item.inspection_date)}</td>${kind === "food" ? `<td>${escapeHtml(item.meal)}</td>` : ""}<td>${escapeHtml(item.inspector_name)}</td><td>${item.score}%</td><td>${item.items.map(check => `<span class="status-chip ${check.status === "Pass" || check.status === "Compliant" ? "status-good" : "status-in-progress"}">${escapeHtml(check.item_name)}: ${escapeHtml(check.status)}</span>`).join(" ")}</td><td>${escapeHtml(item.remarks || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="empty-state">No inspections have been saved yet.</p>`;
    if (kind === "food") {
      document.getElementById("foodInspectionCount").textContent = data.items.length;
      document.getElementById("foodFlagCount").textContent = data.items.reduce((total, item) => total + item.items.filter(check => check.status === "Fail" || check.status === "Needs Improvement").length, 0);
      if (data.items[0]) {
        document.getElementById("foodScore").textContent = Math.round(data.items[0].score);
        document.getElementById("foodScorePage").textContent = Math.round(data.items[0].score);
      }
    } else {
      document.getElementById("hygieneProgress").textContent = data.items.length ? `${data.items[0].items.filter(item => item.status === "Compliant").length} / ${data.items[0].items.length} compliant` : "No checks saved";
      if (data.items[0]) document.getElementById("hygieneScore").textContent = Math.round(data.items[0].score);
    }
  }
  async function bootstrapApplication() {
    try {
      const { user } = await apiRequest("/api/auth/me");
      if (!user) {
        window.location.replace("/login");
        return;
      }
      backendEnabled = true;
      activeUser = user;
      document.querySelectorAll(".profile-top span:nth-child(2),.profile-mini strong").forEach(node => { node.textContent = user.display_name; });
      document.querySelector(".profile-mini small").textContent = user.role;
      if (user.role === "Student") {
        document.getElementById("openStudent").hidden = true;
        document.getElementById("backToAdmin").hidden = true;
        showApp("student");
        await loadStudentData();
      } else {
        await loadManagerData();
        if (user.role === "Inspector") {
          document.getElementById("newPlan").hidden = true;
          document.querySelector('[data-view="settings"]').hidden = true;
          document.querySelector('[data-view="staff"]').hidden = true;
          document.querySelector('[data-view="reports"]').hidden = true;
        }
        if (user.role !== "Admin") document.getElementById("accountCard").hidden = true;
        window.setInterval(() => {
          if (!document.hidden && activeUser?.role !== "Student") {
            loadManagerData().catch(error => notify(`Dashboard refresh failed: ${error.message}`));
          } else if (!document.hidden && activeUser?.role === "Student") {
            loadStudentData().catch(error => notify(`Student app refresh failed: ${error.message}`, true));
          }
        }, 15000);
      }
    } catch (error) {
      if (window.location.protocol === "file:") {
        window.location.replace("http://127.0.0.1:5000/");
        return;
      }
      notify(`Unable to load the canteen data: ${error.message}`);
    }
  }
  function renderRecentComplaints() {
    const tbody = document.getElementById("recentComplaintRows");
    if (!tbody) return;
    tbody.innerHTML = complaints.slice(0, 4).map(item => `<tr><td class="complaint-id">#${escapeHtml(item.id.slice(-4))}</td><td>${escapeHtml(item.date)}</td><td class="issue-cell">${escapeHtml(item.description)}</td><td><span class="priority priority-${item.priority.toLowerCase()}">${escapeHtml(item.priority)}</span></td><td><span class="status-chip status-${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><button class="table-action" data-complaint-action="${escapeHtml(item.id)}">View</button></td></tr>`).join("");
  }
  function renderComplaints() {
    const tbody = document.getElementById("complaintTableRows");
    if (!tbody) return;
    renderComplaintRows();
    const openCount = complaints.filter(item => item.status === "Open" || item.status === "In Progress").length;
    document.getElementById("openComplaints").textContent = openCount;
    document.getElementById("openComplaintMetric").textContent = complaints.filter(item => item.status === "Open").length;
    document.getElementById("totalComplaints").textContent = complaints.length;
    document.getElementById("complaintNavCount").textContent = openCount;
    renderRecentComplaints();
    iconRefresh();
  }
  function viewComplaint(id) {
    const item = complaints.find(complaint => complaint.id === id);
    if (!item) return;
    const next = item.status === "Open" ? "In Progress" : item.status === "In Progress" ? "Resolved" : "Open";
    showModal(`Complaint ${item.id}`, `${item.category} · ${item.priority} priority · Currently ${item.status}. Continue to move it to ${next}.`);
    document.getElementById("modalConfirm").onclick = async () => {
      try {
        if (backendEnabled) {
          const payload = { status: next };
          if (next === "Resolved") payload.resolution = window.prompt("Enter resolution details:", "Issue reviewed and corrective action completed.") || "";
          if (next === "In Progress" && item.assigned === "Unassigned") {
            const staff = await apiRequest("/api/staff");
            if (staff.items.length) payload.assigned_staff_id = staff.items[0].id;
          }
          await apiRequest(`/api/complaints/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
          await loadManagerData();
        } else {
          item.status = next;
          if (next === "In Progress" && item.assigned === "Unassigned") item.assigned = "Alex M.";
          if (next === "Resolved") item.resolution = "Resolved in demo mode.";
          renderComplaints();
        }
        closeModal();
        notify(`${item.id} updated to ${next}.`);
      } catch (error) {
        notify(`Could not update complaint: ${error.message}`);
      }
    };
  }
  function renderFeedback() {
    const container = document.getElementById("feedbackList");
    if (!container) return;
    const meal = document.getElementById("feedbackMealFilter").value;
    const entries = meal === "all" ? feedback : feedback.filter(item => item.meal === meal);
    container.innerHTML = entries.map(item => `<article class="feedback-item"><span class="feedback-avatar">${escapeHtml(item.initials)}</span><div class="feedback-body"><strong>${escapeHtml(item.name)}</strong><span class="feedback-meta">${escapeHtml(item.meal)} · ${escapeHtml(item.date)}</span><p>${escapeHtml(item.comment)}</p></div><span class="feedback-rating">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</span></article>`).join("") || `<p class="empty-state">No feedback for this meal yet.</p>`;
  }
  function renderHistory() {
    const container = document.getElementById("studentHistoryList");
    const items = history.slice().reverse();
    container.innerHTML = items.length ? items.map(item => `<article class="student-card history-item"><span class="history-icon"><i data-lucide="${item.type === "complaint" ? "message-square-warning" : "star"}"></i></span><div><strong>${item.type === "complaint" ? `Complaint ${escapeHtml(item.id)}` : `${escapeHtml(item.meal)} feedback · ${item.rating}/5`}</strong><small>${escapeHtml(item.date)}</small><p>${escapeHtml(item.summary)}</p></div>${item.type === "complaint" ? `<span class="status-chip status-open">${escapeHtml(item.status)}</span>` : ""}</article>`).join("") : `<div class="student-card empty-history"><span class="track-icon"><i data-lucide="notebook-tabs"></i></span><h2>Your activity will show up here</h2><p>When you share feedback or submit a complaint, you'll find it in your history.</p></div>`;
    iconRefresh();
  }
  function renderCriteria(containerId, criteria, kind) {
    const container = document.getElementById(containerId);
    const choices = kind === "food" ? ["Pass", "Needs Improvement", "Fail"] : ["Compliant", "Needs Improvement", "Non-Compliant"];
    container.innerHTML = criteria.map((criterion, index) => `<div class="criteria-row"><strong>${escapeHtml(criterion)}</strong><div class="radio-options">${choices.map((choice, choiceIndex) => `<label><input type="radio" name="${kind}-${index}" value="${choice}" ${choiceIndex === 0 ? "checked" : ""}><span>${choice}</span></label>`).join("")}</div><input name="${kind}-remark-${index}" placeholder="Add remark (optional)" aria-label="Remark for ${escapeHtml(criterion)}"></div>`).join("");
  }
  function updateStudentRating(picker, value) {
    picker.querySelectorAll("button").forEach(button => {
      const selected = Number(button.dataset.value) <= value;
      button.classList.toggle("selected", selected);
      button.textContent = selected ? "★" : "☆";
    });
    const hidden = picker.closest(".rating-question,.rating-row").querySelector(`input[name="${picker.dataset.rating === "overall" ? "overallRating" : picker.dataset.rating + "Rating"}"]`);
    hidden.value = String(value);
    const text = document.getElementById(`${picker.dataset.rating}RatingText`);
    if (text) text.textContent = `${value}/5`;
  }
  function addHistory(item) {
    history.push({ ...item, date: "Just now" });
  }
  function renderReports() {
    const reports = [
      ["Student Feedback Summary", "Ratings, meal preferences, and comment themes.", "messages-square"],
      ["Food Quality Inspection", "Inspection scores and flagged items.", "salad"],
      ["Hygiene Compliance", "Daily checklist compliance and exceptions.", "shield-check"],
      ["Complaint Analysis", "Category trends, priorities, and resolutions.", "chart-no-axes-combined"],
      ["Student Satisfaction", "Rating trends and service measures.", "heart-handshake"],
      ["PDCA Improvement Report", "Improvement actions and before/after outcomes.", "refresh-cw"]
    ];
    document.getElementById("reportsGrid").innerHTML = reports.map(([title, description, icon]) => `<article class="panel report-card"><span class="report-card-icon"><i data-lucide="${icon}"></i></span><h2>${title}</h2><p>${description}</p><div class="report-card-actions"><button class="button button-outline" data-report="${title}" data-format="Preview">Preview</button><button class="button button-outline" data-report="${title}" data-format="pdf">PDF</button><button class="button button-primary" data-report="${title}" data-format="xlsx">Excel</button></div></article>`).join("");
  }
  function setupCharts() {
    if (!window.Chart) {
      document.querySelectorAll(".chart-canvas").forEach(canvas => { canvas.innerHTML = `<div class="chart-fallback">Charts require an internet connection to load Chart.js.</div>`; });
      return;
    }
    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.font.size = 9;
    Chart.defaults.color = "#8994a6";
    const trendCanvas = document.getElementById("satisfactionChart");
    if (trendCanvas) {
      new Chart(trendCanvas, {
        type: "line",
        data: { labels: ["Oct 14", "Oct 15", "Oct 16", "Oct 17", "Oct 18", "Oct 19", "Oct 20"], datasets: [{ data: [3.1, 3.4, 3.0, 3.8, 4.0, 4.3, 4.0], borderColor: "#5865f2", backgroundColor: "rgba(94,103,246,.10)", fill: true, tension: .38, borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 5, pointBackgroundColor: "#fff", pointBorderColor: "#5865f2" }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: context => ` ${context.parsed.y.toFixed(1)} / 5 stars` } } }, scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 }, grid: { color: "#f0f2f6" }, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } } }
      });
    }
    renderPareto("paretoChart");
  }
  function renderPareto(id) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    const old = Chart.getChart(canvas);
    if (old) old.destroy();
    const total = complaintCounts.reduce((sum, count) => sum + count, 0);
    let running = 0;
    const cumulative = complaintCounts.map(count => { running += count; return Math.round(running / total * 100); });
    new Chart(canvas, {
      data: { labels: complaintLabels, datasets: [
        { type: "bar", label: "Number of complaints", data: complaintCounts, backgroundColor: ["#f36572", "#4a95f5", "#44c98a", "#f4b641", "#9d83f4"], borderRadius: 4, barPercentage: .63, yAxisID: "y" },
        { type: "line", label: "Cumulative %", data: cumulative, borderColor: "#ed5360", backgroundColor: "#ed5360", borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: .2, yAxisID: "y1" }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 12, font: { size: 8 } } }, tooltip: { displayColors: true } }, scales: { y: { beginAtZero: true, max: 40, ticks: { stepSize: 10 }, grid: { color: "#f0f2f6" }, border: { display: false }, title: { display: id === "paretoAnalysisChart", text: "Complaints" } }, y1: { beginAtZero: true, max: 100, position: "right", ticks: { callback: value => `${value}%`, stepSize: 20 }, grid: { display: false }, border: { display: false } }, x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 8 } } } } }
    });
  }
  function refreshFeedbackMetrics() {
    const average = feedbackRatingTotal / feedbackCount;
    document.getElementById("feedbackTotal").textContent = feedbackCount;
    document.getElementById("feedbackMetric").textContent = feedbackCount;
    document.getElementById("feedbackAverage").textContent = average.toFixed(1);
    document.getElementById("satisfactionScore").textContent = average.toFixed(1);
    document.getElementById("feedbackNavCount").textContent = feedbackCount;
  }

  document.querySelectorAll(".nav-link[data-view]").forEach(button => button.addEventListener("click", () => showAdminView(button.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => showAdminView(button.dataset.go)));
  document.getElementById("openStudent").addEventListener("click", () => navigateApp("student"));
  document.getElementById("feedbackFromDashboard").addEventListener("click", () => navigateApp("student", "feedback"));
  document.getElementById("backToAdmin").addEventListener("click", () => navigateApp("admin"));
  document.querySelectorAll(".student-tab").forEach(button => button.addEventListener("click", () => showStudentView(button.dataset.studentView)));
  document.querySelectorAll("[data-student-go]").forEach(button => button.addEventListener("click", () => showStudentView(button.dataset.studentGo)));
  document.querySelectorAll(".menu-day-tabs button").forEach((button, index) => button.addEventListener("click", () => {
    document.querySelectorAll(".menu-day-tabs button").forEach(tab => tab.classList.toggle("active", tab === button));
    if (index > 0) notify("The canteen has only published today's menu.", true);
    else if (backendEnabled) loadStudentData().catch(error => notify(`Could not load today's menu: ${error.message}`, true));
  }));
  document.querySelectorAll('button[aria-label="Notifications"]').forEach(button => button.addEventListener("click", () => {
    showModal("Notifications", activeUser?.role === "Student" ? "You are all caught up. Your complaint updates appear in your feedback history." : `${complaints.filter(item => item.status === "Open").length} open complaints need follow-up.`);
  }));
  document.querySelector(".profile-top").addEventListener("click", () => showAdminView("settings"));
  document.querySelector(".more-button").addEventListener("click", () => showAdminView("improvements"));
  document.getElementById("sidebarCollapse").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("collapsed"));
  document.getElementById("menuToggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("mobile-open"));
  document.querySelectorAll(".view-panel").forEach(panel => panel.addEventListener("click", event => {
    const button = event.target.closest("[data-complaint-action]");
    if (button) viewComplaint(button.dataset.complaintAction);
  }));
  ["categoryFilter", "statusFilter", "priorityFilter", "complaintDateStart", "complaintDateEnd"].forEach(id => document.getElementById(id).addEventListener("change", renderComplaints));
  document.getElementById("feedbackMealFilter").addEventListener("change", renderFeedback);
  document.getElementById("trendRange").addEventListener("change", () => {
    if (backendEnabled) loadManagerData().catch(error => notify(`Could not update satisfaction trend: ${error.message}`));
    else notify("Start the Flask app to load satisfaction history.");
  });
  document.querySelectorAll("[data-open-form]").forEach(button => button.addEventListener("click", () => {
    document.getElementById(button.dataset.openForm).scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById(button.dataset.openForm).querySelector("input")?.focus();
  }));
  document.getElementById("serviceTimeForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      await apiRequest("/api/service-times", {
        method: "POST",
        body: JSON.stringify({ duration_minutes: Number(data.get("duration_minutes")), meal: data.get("meal") })
      });
      form.reset();
      notify("Service-time measurement saved.");
      await loadManagerData();
    } catch (error) {
      notify(`Could not save service-time measurement: ${error.message}`, true);
    }
  });
  document.getElementById("foodInspectionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const items = foodCriteria.map((name, index) => ({
      name, status: form.querySelector(`input[name="food-${index}"]:checked`).value,
      remarks: data.get(`food-remark-${index}`)
    }));
    try {
      if (backendEnabled) {
        const result = await apiRequest("/api/inspections/food", {
          method: "POST",
          body: JSON.stringify({ date: data.get("date"), meal: data.get("meal"), inspector_name: data.get("inspector"), remarks: data.get("remarks"), items })
        });
        foodScore = result.score;
        if (result.flagged_items.length) notify(`Inspection saved. ${result.score}% score; corrective actions created for: ${result.flagged_items.join(", ")}.`);
        else notify(`Food inspection saved. Quality score: ${result.score}%.`);
      } else {
        const scoreMap = { Pass: 100, "Needs Improvement": 60, Fail: 0 };
        foodScore = Math.round(items.reduce((sum, item) => sum + scoreMap[item.status], 0) / items.length);
        notify(`Food inspection saved in demo mode. Quality score: ${foodScore}%.`);
      }
      document.getElementById("foodScore").textContent = foodScore;
      document.getElementById("foodScorePage").textContent = foodScore;
      form.reset();
      form.querySelector('[name="date"]').valueAsDate = new Date();
      if (backendEnabled) loadManagerData().catch(error => notify(`Unable to refresh metrics: ${error.message}`));
    } catch (error) { notify(`Could not save inspection: ${error.message}`); }
  });
  document.getElementById("hygieneForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const items = hygieneCriteria.map((name, index) => ({
      name, status: form.querySelector(`input[name="hygiene-${index}"]:checked`).value,
      remarks: data.get(`hygiene-remark-${index}`)
    }));
    try {
      if (backendEnabled) {
        const result = await apiRequest("/api/inspections/hygiene", {
          method: "POST",
          body: JSON.stringify({ date: data.get("date"), inspector_name: data.get("inspector"), remarks: data.get("remarks"), items })
        });
        hygieneScore = result.score;
        notify(result.flagged_items.length ? `Checklist saved. ${result.score}% compliance; corrective actions created for: ${result.flagged_items.join(", ")}.` : `Hygiene checklist saved. Compliance: ${result.score}%.`);
      } else {
        const scoreMap = { Compliant: 100, "Needs Improvement": 50, "Non-Compliant": 0 };
        hygieneScore = Math.round(items.reduce((sum, item) => sum + scoreMap[item.status], 0) / items.length);
        notify(`Hygiene checklist saved in demo mode. Compliance: ${hygieneScore}%.`);
      }
      document.getElementById("hygieneScore").textContent = hygieneScore;
      form.reset();
      form.querySelector('[name="date"]').valueAsDate = new Date();
      if (backendEnabled) loadManagerData().catch(error => notify(`Unable to refresh metrics: ${error.message}`));
    } catch (error) { notify(`Could not save checklist: ${error.message}`); }
  });
  document.querySelectorAll(".star-picker,.mini-star-picker").forEach(picker => picker.addEventListener("click", event => {
    const button = event.target.closest("button[data-value]");
    if (button) updateStudentRating(picker, Number(button.dataset.value));
  }));
  document.getElementById("studentFeedbackForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    if (!data.get("overallRating") || !data.get("foodRating") || !data.get("cleanRating") || !data.get("speedRating")) {
      notify("Please rate the overall experience and each category.", true);
      return;
    }
    const item = { type: "feedback", meal: data.get("meal"), rating: Number(data.get("overallRating")), summary: data.get("comments") || "Thanks for sharing your meal rating." };
    try {
      if (backendEnabled) {
        await apiRequest("/api/feedback", {
          method: "POST",
          body: JSON.stringify({
            overall_rating: Number(data.get("overallRating")), food_rating: Number(data.get("foodRating")),
            cleanliness_rating: Number(data.get("cleanRating")), service_rating: Number(data.get("speedRating")),
            meal: data.get("meal"), comments: data.get("comments") || ""
          })
        });
        await loadStudentData();
      } else {
        feedbackCount += 1;
        feedbackRatingTotal += item.rating;
        feedback.unshift({ name: "You", initials: "ME", meal: item.meal, rating: item.rating, date: "Just now", comment: item.summary });
        addHistory(item);
        refreshFeedbackMetrics();
      }
      form.reset();
      form.querySelectorAll(".star-picker button,.mini-star-picker button").forEach(button => { button.classList.remove("selected"); button.textContent = "☆"; });
      document.querySelectorAll(".rating-row>small").forEach(element => element.textContent = "—");
      notify("Thank you! Your feedback has been saved.", true);
      window.setTimeout(() => showStudentView("history"), 1000);
    } catch (error) { notify(`Could not submit feedback: ${error.message}`, true); }
  });
  document.querySelectorAll("[data-complaint-tab]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-complaint-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
    const tracking = button.dataset.complaintTab === "track";
    document.getElementById("studentComplaintForm").hidden = tracking;
    document.getElementById("trackComplaintForm").hidden = !tracking;
  }));
  document.getElementById("studentComplaintForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const category = data.get("category");
    const description = data.get("description");
    try {
      let id;
      if (backendEnabled) {
        const result = await apiRequest("/api/complaints", {
          method: "POST",
          body: JSON.stringify({ category, description, meal: data.get("meal") })
        });
        id = result.id;
        await loadStudentData();
      } else {
        id = `SC-${nextComplaint++}`;
        complaints.unshift({ id, date: "Today", category, description, priority: "Medium", assigned: "Unassigned", status: "Open" });
        addHistory({ type: "complaint", id, status: "Open", summary: `${category} · ${description}` });
      }
      form.reset();
      showModal("Complaint submitted", `Your complaint ID is ${id}. Keep this ID to track progress.`);
      document.getElementById("modalConfirm").onclick = () => { closeModal(); showStudentView("history"); };
    } catch (error) { notify(`Could not submit complaint: ${error.message}`, true); }
  });
  document.getElementById("trackComplaintForm").addEventListener("submit", async event => {
    event.preventDefault();
    const id = new FormData(event.currentTarget).get("complaintId").trim().toUpperCase();
    try {
      const item = backendEnabled ? (await apiRequest(`/api/complaints/${encodeURIComponent(id)}`)).item : complaints.find(complaint => complaint.id.toUpperCase() === id);
      document.getElementById("trackingResult").innerHTML = item ? `<div class="tracking-card"><strong>${escapeHtml(item.id)} · ${escapeHtml(item.category)}</strong><p>Status: <b>${escapeHtml(item.status)}</b> · Reported ${escapeHtml(asDateLabel(item.created_at) || item.date)}</p>${item.resolution ? `<p>${escapeHtml(item.resolution)}</p>` : ""}</div>` : `<div class="tracking-card"><strong>Complaint not found</strong><p>Check the ID and try again.</p></div>`;
    } catch (error) {
      document.getElementById("trackingResult").innerHTML = `<div class="tracking-card"><strong>Unable to check complaint</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  });
  document.getElementById("newComplaint").addEventListener("click", () => {
    if (backendEnabled && activeUser?.role !== "Student") {
      showModal("Student account required", "To submit a complaint, sign out and log in with a Student account. Managers can review and update complaints from this register.");
      return;
    }
    navigateApp("student", "complaint");
  });
  document.querySelector('[data-action="logout"]').addEventListener("click", () => showModal("Demo mode", "Sign-in and logout will be connected with role-based authentication in a later phase."));
  document.getElementById("addWhy").addEventListener("click", () => {
    const fields = document.getElementById("whyFields");
    const count = fields.querySelectorAll(".why-field").length;
    if (count >= 5) { notify("5 Whys is limited to five follow-up questions in this demo."); return; }
    fields.insertAdjacentHTML("beforeend", `<label class="why-field"><span>Why ${count + 1}</span><input name="why${count + 1}" placeholder="What caused this?" required></label>`);
  });
  document.getElementById("whysForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
      if (backendEnabled) {
        const data = new FormData(form);
        const whys = [...form.querySelectorAll('#whyFields input')].map(input => input.value.trim());
        await apiRequest("/api/analysis/five-whys", { method: "POST", body: JSON.stringify({ problem: data.get("problem"), whys, root_cause: whys.at(-1) || "" }) });
      }
      notify(backendEnabled ? "5 Whys analysis saved." : "5 Whys analysis saved in demo mode.");
    } catch (error) { notify(`Could not save analysis: ${error.message}`); }
  });
  document.getElementById("reportsGrid").addEventListener("click", async event => {
    const button = event.target.closest("[data-report]");
    if (!button) return;
    if (button.dataset.format === "Preview") {
      showModal(`Report preview: ${button.dataset.report}`, "The report is generated from saved database records for the selected report date range.");
      return;
    }
    const type = ({
      "Student Feedback Summary": "feedback", "Food Quality Inspection": "food",
      "Hygiene Compliance": "hygiene", "Complaint Analysis": "complaints",
      "Student Satisfaction": "satisfaction", "PDCA Improvement Report": "improvements"
    })[button.dataset.report];
    try {
      const format = button.dataset.format.toLowerCase();
      const start = document.getElementById("reportStart").value;
      const end = document.getElementById("reportEnd").value;
      if (start && end && start > end) throw new Error("Start date must be on or before the end date.");
      const parameters = new URLSearchParams({ format });
      if (start) parameters.set("start", start);
      if (end) parameters.set("end", end);
      const blob = await apiRequest(`/api/reports/${type}?${parameters}`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${type}-report.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { notify(`Could not export report: ${error.message}`); }
  });
  document.getElementById("dateRange").addEventListener("click", () => showModal("Dashboard date range", "The dashboard currently shows sample records for October 14–20, 2026. Date-range filtering will be connected to database records in a later phase."));
  document.getElementById("view-improvements").addEventListener("click", async event => {
    const button = event.target.closest(".plan-open");
    if (!button) return;
    const stages = ["Plan", "Do", "Check", "Act", "Completed"];
    const next = stages[Math.min(stages.indexOf(button.dataset.stage) + 1, stages.length - 1)];
    const progress = { Plan: 0, Do: 30, Check: 60, Act: 85, Completed: 100 }[next];
    if (!backendEnabled) {
      showModal(`Improvement plan ${button.dataset.plan}`, "Plan tracking needs the Flask server.");
      return;
    }
    try {
      await apiRequest(`/api/improvements/${button.dataset.plan}`, {
        method: "PATCH", body: JSON.stringify({ stage: next, status: next === "Completed" ? "Completed" : next === "Check" ? "Checking results" : "In Progress", progress })
      });
      await loadTqmData();
      notify(`PDCA plan advanced to ${next}.`);
    } catch (error) { notify(`Could not update plan: ${error.message}`); }
  });
  document.getElementById("newPlan").addEventListener("click", async () => {
    if (!backendEnabled) {
      showModal("New improvement plan", "Improvement plans require the Flask server.");
      return;
    }
    const title = window.prompt("Improvement plan title:");
    if (!title) return;
    const problem = window.prompt("Describe the quality problem:");
    const target = window.prompt("Set a measurable target:");
    if (!problem || !target) { notify("Title, problem, and target are required."); return; }
    try {
      await apiRequest("/api/improvements", { method: "POST", body: JSON.stringify({ title, problem, target }) });
      notify("Improvement plan created.");
      await loadTqmData();
    } catch (error) { notify(`Could not create plan: ${error.message}`); }
  });
  document.getElementById("fishboneForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      if (!backendEnabled) throw new Error("Fishbone analysis needs the Flask server.");
      await apiRequest("/api/analysis/fishbone", { method: "POST", body: JSON.stringify({ problem: data.get("problem"), category: data.get("category"), cause: data.get("cause") }) });
      form.querySelector('[name="cause"]').value = "";
      await loadTqmData();
      notify("Fishbone cause recorded.");
    } catch (error) { notify(`Could not record cause: ${error.message}`); }
  });
  document.getElementById("controlMetric").addEventListener("change", () => {
    if (backendEnabled) loadTqmData().catch(error => notify(`Could not refresh control chart: ${error.message}`));
  });
  document.getElementById("staffForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      await apiRequest("/api/staff", { method: "POST", body: JSON.stringify({ name: data.get("name"), position: data.get("position") }) });
      form.reset();
      form.querySelector('[name="position"]').value = "Canteen staff";
      await loadStaffData();
      notify("Staff member registered.");
    } catch (error) { notify(`Could not register staff member: ${error.message}`); }
  });
  document.getElementById("taskForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = { title: data.get("title"), description: data.get("description"), due_date: data.get("due_date") || null, assigned_staff_id: data.get("assigned_staff_id") ? Number(data.get("assigned_staff_id")) : null };
    try {
      await apiRequest("/api/corrective-actions", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await loadStaffData();
      notify("Corrective-action task created.");
    } catch (error) { notify(`Could not create task: ${error.message}`); }
  });
  document.getElementById("accountForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      const result = await apiRequest("/api/auth/users", {
        method: "POST",
        body: JSON.stringify({ display_name: data.get("display_name"), username: data.get("username"), password: data.get("password"), role: data.get("role") })
      });
      form.reset();
      notify(`Account created for ${result.username} (${result.role}).`);
    } catch (error) { notify(`Could not create account: ${error.message}`); }
  });
  document.getElementById("taskList").addEventListener("change", async event => {
    const select = event.target.closest(".task-status");
    const row = select?.closest("[data-task-id]");
    if (!select || !row) return;
    try {
      await apiRequest(`/api/corrective-actions/${row.dataset.taskId}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
      notify("Task status updated.");
    } catch (error) { notify(`Could not update task: ${error.message}`); }
  });
  document.querySelectorAll(".settings-edit").forEach(button => button.addEventListener("click", () => showModal("Canteen profile", "Profile editing will be available in a later phase.")));
  document.getElementById("globalSearch").addEventListener("keydown", event => {
    if (event.key !== "Enter" || !event.currentTarget.value.trim()) return;
    const query = event.currentTarget.value.toLowerCase();
    const match = complaints.find(item => `${item.id} ${item.description} ${item.category}`.toLowerCase().includes(query));
    if (match) { showAdminView("complaints"); document.getElementById("globalSearch").value = ""; viewComplaint(match.id); }
    else notify("No matching complaint found in the demo records.");
  });
  document.getElementById("quickDate").addEventListener("click", () => document.getElementById("dateRange").click());
  document.getElementById("modalConfirm").addEventListener("click", closeModal);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("modalBackdrop").addEventListener("click", event => { if (event.target.id === "modalBackdrop") closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeModal(); document.getElementById("sidebar").classList.remove("mobile-open"); } });
  window.addEventListener("popstate", () => showApp(new URLSearchParams(window.location.search).get("app") === "student" ? "student" : "admin"));
  document.querySelector('[data-action="logout"]').addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      window.location.replace("/login");
    } catch (error) { notify(`Could not sign out: ${error.message}`); }
  });
  document.getElementById("studentLogout").addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      window.location.replace("/login");
    } catch (error) { notify(`Could not sign out: ${error.message}`, true); }
  });

  renderCriteria("foodCriteria", foodCriteria, "food");
  renderCriteria("hygieneCriteria", hygieneCriteria, "hygiene");
  document.getElementById("whyFields").innerHTML = `<label class="why-field"><span>Why 1</span><input name="why1" placeholder="Why is the queue long?" required></label><label class="why-field"><span>Why 2</span><input name="why2" placeholder="What caused that?" required></label>`;
  document.getElementById("foodInspectionForm").querySelector('[name="date"]').valueAsDate = new Date();
  document.getElementById("hygieneForm").querySelector('[name="date"]').valueAsDate = new Date();
  document.getElementById("reportEnd").valueAsDate = new Date();
  const reportStartDate = new Date();
  reportStartDate.setDate(reportStartDate.getDate() - 30);
  document.getElementById("reportStart").valueAsDate = reportStartDate;
  renderReports();
  renderComplaints();
  renderFeedback();
  setupCharts();
  iconRefresh();
  bootstrapApplication();
})();
