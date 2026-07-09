import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  deleteDoc,
  updateDoc,
  getDocs,
  getDoc,
  where,
  serverTimestamp,
  limit,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6rgutkYK7MZ3F0Xne6Zs4PyEiPME7ePM",
  authDomain: "onevictoria-23409.firebaseapp.com",
  projectId: "onevictoria-23409",
  storageBucket: "onevictoria-23409.firebasestorage.app",
  messagingSenderId: "334731169631",
  appId: "1:334731169631:web:7484599232fef8b06eb0ea",
  measurementId: "G-0ML9K6JSK8",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ===== STATUS CONSTANTS (match resident side) =====
const STATUS = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  REGISTERED: "Registered",
  CANCELLED: "Cancelled",
};

let digitalCheckInRegistry = [];
let pendingConfirmCallback = null;
let loggedInAdmin = null;
let selectedResidentId = null;

// ===== HELPER FUNCTION TO GET ADMIN DISPLAY NAME =====
function getAdminDisplayName() {
  if (loggedInAdmin?.name) return loggedInAdmin.name;
  if (loggedInAdmin?.email)
    return loggedInAdmin.email
      .split("@")[0]
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  return "System Administrator";
}

// ===== DATE & TIME UTILITIES =====
function formatDateTime(dateValue, timeValue) {
  if (!dateValue) return "N/A";
  let formatted = dateValue;
  if (timeValue) formatted += ` at ${formatTime(timeValue)}`;
  return formatted;
}
function formatTime(timeValue) {
  if (!timeValue) return "";
  if (typeof timeValue === "string" && timeValue.includes(":")) {
    const [hours, minutes] = timeValue.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    return `${h % 12 || 12}:${minutes} ${ampm}`;
  }
  return timeValue;
}
function formatFirebaseTimestamp(timestamp) {
  if (!timestamp) return "N/A";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return (
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }) +
    " at " +
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  );
}

// ===== SESSION PERSISTENCE SYSTEM =====
function saveAdminSession(adminData) {
  const sessionData = {
    id: adminData.id,
    name: adminData.name || getAdminDisplayName(),
    role: adminData.role || "admin",
    email: adminData.email,
  };
  localStorage.setItem("barangayAdmin", JSON.stringify(sessionData));
}
function clearAdminSession() {
  localStorage.removeItem("barangayAdmin");
  sessionStorage.removeItem("adminActiveTab");
}
function getSavedAdminSession() {
  const saved = localStorage.getItem("barangayAdmin");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      clearAdminSession();
      return null;
    }
  }
  return null;
}
function saveActiveTab(tabId) {
  sessionStorage.setItem("adminActiveTab", tabId);
}
function getSavedActiveTab() {
  return sessionStorage.getItem("adminActiveTab") || "announcements";
}

// LOADING FUNCTIONS
window.showLoading = function () {
  const el = document.getElementById("global-loading");
  if (el) el.classList.remove("hidden");
};
window.hideLoading = function () {
  const el = document.getElementById("global-loading");
  if (el) el.classList.add("hidden");
};

// MODERN CUSTOM ALERT MODAL
window.showAdminAlert = function (title, message, isSuccess = true) {
  const box = document.getElementById("admin-alert-icon"),
    alertTitle = document.getElementById("admin-alert-title");
  const alertMsg = document.getElementById("admin-alert-msg"),
    alertModal = document.getElementById("admin-alert-modal");
  if (!box || !alertTitle || !alertMsg || !alertModal) {
    alert(`${isSuccess ? "Success" : "Error"}: ${title}\n${message}`);
    return;
  }
  if (isSuccess) {
    box.className =
      "w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 text-xl";
    box.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
  } else {
    box.className =
      "w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3 text-xl";
    box.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
  }
  alertTitle.innerText = title;
  alertMsg.innerText = message;
  alertModal.classList.remove("hidden");
};

// CONFIRMATION POPUP SYSTEM
window.showConfirmPopup = function (title, text, proceedCallback) {
  const confirmTitle = document.getElementById("confirm-title"),
    confirmMsg = document.getElementById("confirm-msg"),
    confirmModal = document.getElementById("confirm-modal");
  if (!confirmTitle || !confirmMsg || !confirmModal) {
    if (confirm(text) && typeof proceedCallback === "function")
      proceedCallback();
    return;
  }
  confirmTitle.innerText = title;
  confirmMsg.innerText = text;
  confirmModal.classList.remove("hidden");
  pendingConfirmCallback = proceedCallback;
};

// TOGGLE MODAL FUNCTION
window.toggleModal = function (id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.toggle("hidden");
};

// ===== CREATE NOTIFICATION FOR RESIDENT =====
async function createNotification(residentId, title, message, type = "general") {
  if (!residentId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      residentId: residentId,
      title: title,
      message: message,
      type: type,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Failed to create notification:", e);
  }
}

// ===== DOM CONTENT LOADED INITIALIZATION =====
document.addEventListener("DOMContentLoaded", function () {
  initializeEventListeners();
  const loginScreen = document.getElementById("login-screen"),
    dashboard = document.getElementById("dashboard");
  const savedAdmin = getSavedAdminSession();
  window.showLoading();
  if (savedAdmin && savedAdmin.id) {
    loggedInAdmin = savedAdmin;
    if (loginScreen) loginScreen.classList.add("hidden");
    if (dashboard) dashboard.classList.remove("hidden");
    window.switchTab(getSavedActiveTab());
    initDigitalCheckInsListener();
    initResidentsListener();
    initActivityLogsListener();
    setTimeout(() => window.hideLoading(), 800);
  } else {
    if (dashboard) dashboard.classList.add("hidden");
    if (loginScreen) loginScreen.classList.remove("hidden");
    setTimeout(() => window.hideLoading(), 800);
  }
});

// ===== INITIALIZE ALL EVENT LISTENERS =====
function initializeEventListeners() {
  document
    .getElementById("confirm-cancel-btn")
    ?.addEventListener("click", () => {
      document.getElementById("confirm-modal")?.classList.add("hidden");
      pendingConfirmCallback = null;
    });
  document
    .getElementById("confirm-proceed-btn")
    ?.addEventListener("click", () => {
      document.getElementById("confirm-modal")?.classList.add("hidden");
      if (typeof pendingConfirmCallback === "function")
        pendingConfirmCallback();
      pendingConfirmCallback = null;
    });
  document
    .getElementById("login-form")
    ?.addEventListener("submit", handleLogin);
  document
    .getElementById("announcement-form")
    ?.addEventListener("submit", handleAnnouncementSubmit);
  document
    .getElementById("event-form")
    ?.addEventListener("submit", handleEventSubmit);
  document
    .getElementById("edit-event-form")
    ?.addEventListener("submit", handleEditEventSubmit);
  document
    .getElementById("hour-form")
    ?.addEventListener("submit", handleHourSubmit);
  document
    .getElementById("resident-edit-form")
    ?.addEventListener("submit", handleResidentEdit);
}

// ===== LOGIN HANDLER =====
async function handleLogin(e) {
  e.preventDefault();
  window.showLoading();
  const emailInput = document.getElementById("login-email"),
    passInput = document.getElementById("login-password");
    
  if (!emailInput || !passInput) {
    window.hideLoading();
    window.showAdminAlert("Error", "Login form elements not found", false);
    return;
  }
  
  // FIX APPLIED: Removed .toLowerCase() so it matches mixed-case DB entries exactly.
  // FIX APPLIED: Added .trim() to password to prevent invisible copy-paste spaces.
  const email = emailInput.value.trim(),
    pass = passInput.value.trim();
    
  if (!email || !pass) {
    window.hideLoading();
    window.showAdminAlert(
      "Error",
      "Please enter both email and password",
      false,
    );
    return;
  }
  
  try {
    const q = query(
      collection(db, "admins"),
      where("email", "==", email),
      where("password", "==", pass),
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      snap.forEach((doc) => {
        const adminData = doc.data();
        loggedInAdmin = {
          id: doc.id,
          email: email,
          name: adminData.name || getAdminDisplayName(),
          role: adminData.role || "admin",
        };
      });
      saveAdminSession(loggedInAdmin);
      saveActiveTab("announcements");
      document.getElementById("login-screen")?.classList.add("hidden");
      document.getElementById("dashboard")?.classList.remove("hidden");
      initDigitalCheckInsListener();
      initResidentsListener();
      initActivityLogsListener();
      window.switchTab("announcements");
      window.showAdminAlert(
        "Success",
        `Welcome back, ${getAdminDisplayName()}!`,
        true,
      );
    } else {
      window.showAdminAlert(
        "Login Failed",
        "Invalid credentials. Please try again.",
        false,
      );
    }
  } catch (err) {
    window.showAdminAlert("Authentication Error", err.message, false);
  } finally {
    window.hideLoading();
  }
}

// ===== ANNOUNCEMENT HANDLER =====
async function handleAnnouncementSubmit(e) {
  e.preventDefault();
  window.showLoading();
  const annTitle = document.getElementById("ann-title"),
    annPriority = document.getElementById("ann-priority"),
    annDesc = document.getElementById("ann-desc");
  if (!annTitle || !annPriority || !annDesc) {
    window.hideLoading();
    window.showAdminAlert("Error", "Form elements not found", false);
    return;
  }
  if (!annTitle.value.trim() || !annDesc.value.trim()) {
    window.hideLoading();
    window.showAdminAlert("Error", "Please fill in all fields", false);
    return;
  }
  try {
    await addDoc(collection(db, "announcements"), {
      title: annTitle.value.trim(),
      priority: annPriority.value,
      desc: annDesc.value.trim(),
      createdBy: getAdminDisplayName(),
      createdById: loggedInAdmin?.id || "system",
      createdAt: serverTimestamp(),
    });
    window.toggleModal("announcement-modal");
    document.getElementById("announcement-form").reset();
    window.showAdminAlert("Success", "Announcement posted successfully!", true);
  } catch (err) {
    window.showAdminAlert(
      "Error",
      "Failed to post announcement: " + err.message,
      false,
    );
  } finally {
    window.hideLoading();
  }
}

// ===== EVENT HANDLER =====
async function handleEventSubmit(e) {
  e.preventDefault();
  window.showLoading();
  const eventTitle = document.getElementById("event-title"),
    eventDate = document.getElementById("event-date");
  const eventTime = document.getElementById("event-time"),
    eventLocation = document.getElementById("event-location");
  const eventCategory = document.getElementById("event-category"),
    eventImage = document.getElementById("event-image");
  const eventDesc = document.getElementById("event-desc");
  
  if (!eventTitle || !eventDate || !eventLocation || !eventCategory || !eventDesc) {
    window.hideLoading();
    window.showAdminAlert("Error", "Form elements not found", false);
    return;
  }
  
  // Validate all fields have values
  const titleVal = eventTitle.value.trim();
  const dateVal = eventDate.value;
  const locationVal = eventLocation.value.trim();
  const categoryVal = eventCategory.value;
  const descVal = eventDesc.value.trim();
  
  if (!titleVal || !dateVal || !locationVal || !categoryVal || !descVal) {
    window.hideLoading();
    window.showAdminAlert("Error", "Please fill in all required fields", false);
    return;
  }
  
  try {
    // Build event data with only defined values
    const eventData = {
      title: titleVal,
      date: dateVal,
      location: locationVal,
      type: categoryVal,
      imageUrl: eventImage?.value?.trim() || "",
      desc: descVal,
      createdBy: getAdminDisplayName(),
      createdById: loggedInAdmin?.id || "system",
      createdAt: serverTimestamp(),
    };
    
    // Only add time if it has a value
    if (eventTime && eventTime.value && eventTime.value.trim() !== "") {
      eventData.time = eventTime.value.trim();
    }
    
    await addDoc(collection(db, "events"), eventData);
    window.toggleModal("event-modal");
    document.getElementById("event-form").reset();
    window.showAdminAlert("Success", "Event created successfully!", true);
  } catch (err) {
    console.error("Event creation error:", err);
    window.showAdminAlert("Error", "Failed to create event: " + err.message, false);
  } finally {
    window.hideLoading();
  }
}

// ===== EDIT EVENT HANDLER =====
async function handleEditEventSubmit(e) {
  e.preventDefault();
  const eventId = document.getElementById("edit-event-id")?.value;
  if (!eventId) {
    window.showAdminAlert("Error", "No event selected for editing.", false);
    return;
  }

  const title = document.getElementById("edit-event-title")?.value.trim() || "";
  const date = document.getElementById("edit-event-date")?.value || "";
  const time = document.getElementById("edit-event-time")?.value || "";
  const location =
    document.getElementById("edit-event-location")?.value.trim() || "";
  const category = document.getElementById("edit-event-category")?.value || "";
  const imageUrl =
    document.getElementById("edit-event-image")?.value.trim() || "";
  const desc = document.getElementById("edit-event-desc")?.value.trim() || "";

  if (!title || !date || !location || !category || !desc) {
    window.showAdminAlert(
      "Error",
      "Please fill in all required fields.",
      false,
    );
    return;
  }

  window.showLoading();
  try {
    const updateData = {
      title,
      date,
      location,
      type: category,
      imageUrl: imageUrl || "",
      desc,
      updatedBy: getAdminDisplayName(),
      updatedById: loggedInAdmin?.id || "system",
      updatedAt: serverTimestamp(),
    };
    if (time) updateData.time = time;
    await updateDoc(doc(db, "events", eventId), updateData);
    window.toggleModal("edit-event-modal");
    window.showAdminAlert("Success", "Event updated successfully!", true);
  } catch (err) {
    window.showAdminAlert(
      "Error",
      `Failed to update event: ${err.message}`,
      false,
    );
  } finally {
    window.hideLoading();
  }
}

// ===== OPEN EDIT EVENT MODAL =====
window.openEditEventModal = async function (eventId) {
  window.showLoading();
  try {
    const docSnap = await getDoc(doc(db, "events", eventId));
    if (!docSnap.exists()) {
      window.hideLoading();
      window.showAdminAlert("Error", "Event not found.", false);
      return;
    }
    const ev = docSnap.data();
    document.getElementById("edit-event-id").value = eventId;
    document.getElementById("edit-event-title").value = ev.title || "";
    document.getElementById("edit-event-date").value = ev.date || "";
    document.getElementById("edit-event-time").value = ev.time || "";
    document.getElementById("edit-event-location").value = ev.location || "";
    document.getElementById("edit-event-category").value =
      ev.type || ev.category || "";
    document.getElementById("edit-event-image").value = ev.imageUrl || "";
    document.getElementById("edit-event-desc").value = ev.desc || "";
    window.toggleModal("edit-event-modal");
  } catch (err) {
    window.showAdminAlert("Error", "Failed to load event data.", false);
  } finally {
    window.hideLoading();
  }
};

// ===== HOUR HANDLER =====
async function handleHourSubmit(e) {
  e.preventDefault();
  const hourSelect = document.getElementById("hour-participant-select"),
    hourInput = document.getElementById("hour-value");
  if (!hourSelect || !hourInput) {
    window.showAdminAlert("Error", "Form elements not found", false);
    return;
  }
  const registryId = hourSelect.value,
    hourValue = parseFloat(hourInput.value);
  if (!registryId) {
    window.showAdminAlert(
      "Missing Target",
      "Please select a valid resident check-in record.",
      false,
    );
    return;
  }
  if (isNaN(hourValue) || hourValue <= 0) {
    window.showAdminAlert(
      "Invalid Hours",
      "Please enter a valid positive number for hours.",
      false,
    );
    return;
  }
  window.showLoading();
  const contextItem = digitalCheckInRegistry.find((x) => x.id === registryId);
  if (!contextItem) {
    window.hideLoading();
    window.showAdminAlert(
      "Registry Desync",
      "The record reference could not be located.",
      false,
    );
    return;
  }
  try {
    await addDoc(collection(db, "service_hours"), {
      residentId: contextItem.residentId,
      residentName: contextItem.residentName,
      eventTitle: contextItem.eventTitle,
      eventId: contextItem.eventId || "",
      hours: hourValue,
      status: STATUS.APPROVED,
      certifiedBy: getAdminDisplayName(),
      certifiedById: loggedInAdmin?.id || "system",
      certifiedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "participants", registryId), {
      status: STATUS.COMPLETED,
      completedAt: serverTimestamp(),
      completedBy: getAdminDisplayName(),
      hoursCredited: hourValue,
    });
    
    // Notify resident
    await createNotification(
      contextItem.residentId,
      "Service Hours Credited",
      `${hourValue} hours have been credited to your account for "${contextItem.eventTitle}".`,
      "hours_credited"
    );
    
    window.showAdminAlert(
      "Success",
      `Successfully credited ${hourValue} hours to ${contextItem.residentName}!`,
      true,
    );
    
    // Reset Form Fields
    hourInput.value = "";
    hourSelect.value = "";
    
  } catch (err) {
    window.showAdminAlert(
      "Error",
      `Failed to record hours: ${err.message}`,
      false,
    );
  } finally {
    window.hideLoading();
  }
}

// ===== RESIDENT MANAGEMENT =====
function initResidentsListener() {
  const tbody = document.getElementById("residents-tbody");
  if (!tbody) return;
  onSnapshot(
    query(collection(db, "residents"), orderBy("createdAt", "desc")),
    (snapshot) => {
      if (snapshot.empty) {
        tbody.innerHTML =
          '<tr><td colspan="4" class="px-4 py-6 text-center text-stone-400">No registered residents found.</td></tr>';
        return;
      }
      let html = "";
      snapshot.forEach((docSnap) => {
        const r = docSnap.data(),
          id = docSnap.id;
        const statusBadge = r.isOnline
          ? '<span class="badge-success px-2 py-0.5 rounded text-xs font-bold">Online</span>'
          : '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold">Offline</span>';
        html += `<tr class="hover:bg-stone-50 border-b table-row"><td class="px-5 py-4"><div class="font-bold text-stone-900">${r.name || "N/A"}</div><div class="text-xs text-stone-500">${r.phone || "No contact"}</div></td><td class="px-5 py-4 text-sm text-stone-600">${r.address || "N/A"}</td><td class="px-5 py-4">${statusBadge}</td><td class="px-5 py-4"><div class="flex space-x-2"><button onclick="openResidentEdit('${id}')" class="text-xs bg-victoria-light text-victoria-blue px-3 py-1.5 rounded-lg font-bold hover:bg-victoria-blue hover:text-white transition-all"><i class="fa-solid fa-edit mr-1"></i>Edit</button><button onclick="deleteResident('${id}','${(r.name || "Unknown").replace(/'/g, "\\'")}')" class="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold hover:bg-red-600 hover:text-white transition-all"><i class="fa-solid fa-trash mr-1"></i>Delete</button></div></td></tr>`;
      });
      tbody.innerHTML = html;
    },
  );
}

window.openResidentEdit = async function (residentId) {
  window.showLoading();
  try {
    const docSnap = await getDoc(doc(db, "residents", residentId));
    if (!docSnap.exists()) {
      window.hideLoading();
      window.showAdminAlert("Error", "Resident not found.", false);
      return;
    }
    const r = docSnap.data();
    selectedResidentId = residentId;
    document.getElementById("edit-resident-name").value = r.name || "";
    document.getElementById("edit-resident-phone").value = r.phone || "";
    document.getElementById("edit-resident-age").value = r.age || "";
    document.getElementById("edit-resident-gender").value = r.gender || "Male";
    document.getElementById("edit-resident-address").value = r.address || "";
    window.toggleModal("resident-edit-modal");
  } catch (err) {
    window.showAdminAlert("Error", "Failed to load resident data.", false);
  } finally {
    window.hideLoading();
  }
};
async function handleResidentEdit(e) {
  e.preventDefault();
  if (!selectedResidentId) {
    window.showAdminAlert("Error", "No resident selected.", false);
    return;
  }
  const name = document.getElementById("edit-resident-name")?.value.trim();
  if (!name) {
    window.showAdminAlert("Error", "Name cannot be empty.", false);
    return;
  }
  window.showLoading();
  try {
    const updateData = {
      name,
      phone: document.getElementById("edit-resident-phone")?.value.trim() || "",
      age: parseInt(document.getElementById("edit-resident-age")?.value.trim()) || 0,
      gender: document.getElementById("edit-resident-gender")?.value || "Male",
      address: document.getElementById("edit-resident-address")?.value.trim() || "",
      lastModifiedBy: getAdminDisplayName(),
      lastModifiedById: loggedInAdmin?.id || "system",
      lastModifiedAt: serverTimestamp(),
    };
    
    await updateDoc(doc(db, "residents", selectedResidentId), updateData);
    window.toggleModal("resident-edit-modal");
    selectedResidentId = null;
    window.showAdminAlert("Success", "Resident updated successfully!", true);
  } catch (err) {
    window.showAdminAlert("Error", "Failed to update: " + err.message, false);
  } finally {
    window.hideLoading();
  }
}
window.deleteResident = function (residentId, residentName) {
  window.showConfirmPopup(
    "Delete Resident?",
    `Permanently delete "${residentName}"?`,
    async () => {
      window.showLoading();
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "residents", residentId));
        const pSnap = await getDocs(
          query(
            collection(db, "participants"),
            where("residentId", "==", residentId),
          ),
        );
        pSnap.forEach((d) => batch.delete(d.ref));
        const vSnap = await getDocs(
          query(
            collection(db, "volunteers"),
            where("residentId", "==", residentId),
          ),
        );
        vSnap.forEach((d) => batch.delete(d.ref));
        const dSnap = await getDocs(
          query(
            collection(db, "donations"),
            where("donorId", "==", residentId),
          ),
        );
        dSnap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        window.showAdminAlert("Success", `Resident deleted.`, true);
      } catch (err) {
        window.showAdminAlert("Error", err.message, false);
      } finally {
        window.hideLoading();
      }
    },
  );
};

// ===== VOLUNTEER STATUS UPDATE (with notifications) =====
window.updateVolunteerStatus = async function (volunteerId, newStatus) {
  window.showLoading();
  try {
    // Get volunteer data first
    const volSnap = await getDoc(doc(db, "volunteers", volunteerId));
    if (!volSnap.exists()) {
      window.hideLoading();
      window.showAdminAlert("Error", "Volunteer record not found.", false);
      return;
    }
    const volData = volSnap.data();
    const residentId = volData.residentId;
    
    await updateDoc(doc(db, "volunteers", volunteerId), {
      status: newStatus,
      reviewedBy: getAdminDisplayName(),
      reviewedById: loggedInAdmin?.id || "system",
      reviewedAt: serverTimestamp(),
    });
    
    // Create notification for resident
    if (residentId) {
      const statusMsg = newStatus === STATUS.APPROVED 
        ? "approved" 
        : newStatus === STATUS.REJECTED 
        ? "rejected" 
        : "reset to pending";
      
      await createNotification(
        residentId,
        `Volunteer Application ${statusMsg}`,
        `Your volunteer application for "${volData.skills || "volunteer work"}" has been ${statusMsg} by ${getAdminDisplayName()}.`,
        newStatus === STATUS.APPROVED ? "volunteer_approved" : newStatus === STATUS.REJECTED ? "volunteer_rejected" : "general"
      );
    }
    
    window.showAdminAlert(
      "Success",
      `Volunteer application ${newStatus.toLowerCase()}! Resident has been notified.`,
      true,
    );
  } catch (err) {
    window.showAdminAlert("Error", "Failed to update.", false);
  } finally {
    window.hideLoading();
  }
};

// ===== REJECT / RESTORE SERVICE HOURS (with notifications) =====
window.rejectServiceHours = async function (hourId) {
  window.showConfirmPopup(
    "Reject Hours?",
    "Mark this record as rejected?",
    async () => {
      window.showLoading();
      try {
        const hDoc = await getDoc(doc(db, "service_hours", hourId));
        if (!hDoc.exists()) {
          window.hideLoading();
          window.showAdminAlert("Error", "Record not found.", false);
          return;
        }
        const hData = hDoc.data();
        await updateDoc(doc(db, "service_hours", hourId), {
          status: STATUS.REJECTED,
          rejectedBy: getAdminDisplayName(),
          rejectedById: loggedInAdmin?.id || "system",
          rejectedAt: serverTimestamp(),
        });
        
        // Notify resident
        if (hData.residentId) {
          await createNotification(
            hData.residentId,
            "Service Hours Rejected",
            `Your ${hData.hours || 0} hours for "${hData.eventTitle || "community service"}" have been rejected by ${getAdminDisplayName()}.`,
            "hours_rejected"
          );
        }
        
        if (hData.eventId && hData.residentId) {
          const pSnap = await getDocs(
            query(
              collection(db, "participants"),
              where("eventId", "==", hData.eventId),
              where("residentId", "==", hData.residentId),
              where("status", "==", STATUS.COMPLETED),
            ),
          );
          if (!pSnap.empty) {
            const batch = writeBatch(db);
            pSnap.forEach((d) =>
              batch.update(d.ref, {
                status: STATUS.REJECTED,
                rejectedAt: serverTimestamp(),
                rejectedBy: getAdminDisplayName(),
                hoursCredited: 0,
              }),
            );
            await batch.commit();
          }
        }
        window.showAdminAlert("Success", "Hours rejected. Resident notified.", true);
      } catch (err) {
        window.showAdminAlert("Error", err.message, false);
      } finally {
        window.hideLoading();
      }
    },
  );
};
window.restoreServiceHours = async function (hourId) {
  window.showConfirmPopup(
    "Restore Hours?",
    "Restore this record to Approved?",
    async () => {
      window.showLoading();
      try {
        const hDoc = await getDoc(doc(db, "service_hours", hourId));
        if (!hDoc.exists()) {
          window.hideLoading();
          window.showAdminAlert("Error", "Record not found.", false);
          return;
        }
        const hData = hDoc.data();
        await updateDoc(doc(db, "service_hours", hourId), {
          status: STATUS.APPROVED,
          restoredBy: getAdminDisplayName(),
          restoredById: loggedInAdmin?.id || "system",
          restoredAt: serverTimestamp(),
        });
        
        // Notify resident
        if (hData.residentId) {
          await createNotification(
            hData.residentId,
            "Service Hours Restored",
            `Your ${hData.hours || 0} hours for "${hData.eventTitle || "community service"}" have been restored by ${getAdminDisplayName()}.`,
            "hours_restored"
          );
        }
        
        if (hData.eventId && hData.residentId) {
          const pSnap = await getDocs(
            query(
              collection(db, "participants"),
              where("eventId", "==", hData.eventId),
              where("residentId", "==", hData.residentId),
              where("status", "==", STATUS.REJECTED),
            ),
          );
          if (!pSnap.empty) {
            const batch = writeBatch(db);
            pSnap.forEach((d) =>
              batch.update(d.ref, {
                status: STATUS.COMPLETED,
                completedAt: serverTimestamp(),
                completedBy: getAdminDisplayName(),
                hoursCredited: hData.hours || 0,
                restoredAt: serverTimestamp(),
              }),
            );
            await batch.commit();
          }
        }
        window.showAdminAlert("Success", "Hours restored. Resident notified.", true);
      } catch (err) {
        window.showAdminAlert("Error", err.message, false);
      } finally {
        window.hideLoading();
      }
    },
  );
};

// ===== BULK APPROVE VOLUNTEERS (with notifications) =====
window.bulkApproveVolunteers = async function () {
  window.showConfirmPopup(
    "Bulk Approve?",
    "Approve ALL pending volunteers?",
    async () => {
      window.showLoading();
      try {
        const snap = await getDocs(
          query(collection(db, "volunteers"), where("status", "==", STATUS.PENDING)),
        );
        if (snap.empty) {
          window.hideLoading();
          window.showAdminAlert("Info", "No pending volunteers.", true);
          return;
        }
        const batch = writeBatch(db);
        const notifications = [];
        snap.forEach((d) => {
          const data = d.data();
          batch.update(d.ref, {
            status: STATUS.APPROVED,
            reviewedBy: getAdminDisplayName(),
            reviewedById: loggedInAdmin?.id || "system",
            reviewedAt: serverTimestamp(),
          });
          if (data.residentId) {
            notifications.push({
              residentId: data.residentId,
              title: "Volunteer Application Approved",
              message: `Your volunteer application for "${data.skills || "volunteer work"}" has been approved by ${getAdminDisplayName()}.`,
              type: "volunteer_approved"
            });
          }
        });
        await batch.commit();
        
        // Send notifications
        for (const notif of notifications) {
          await createNotification(notif.residentId, notif.title, notif.message, notif.type);
        }
        
        window.showAdminAlert(
          "Success",
          `Approved ${snap.size} volunteers! All notified.`,
          true,
        );
      } catch (err) {
        window.showAdminAlert("Error", err.message, false);
      } finally {
        window.hideLoading();
      }
    },
  );
};

// ===== DONATION STATUS UPDATE (with notifications) =====
window.updateDonationStatus = async function (donationId, newStatus) {
  window.showLoading();
  try {
    // Get donation data first
    const donSnap = await getDoc(doc(db, "donations", donationId));
    if (!donSnap.exists()) {
      window.hideLoading();
      window.showAdminAlert("Error", "Donation record not found.", false);
      return;
    }
    const donData = donSnap.data();
    const residentId = donData.donorId;
    
    await updateDoc(doc(db, "donations", donationId), {
      status: newStatus,
      reviewedBy: getAdminDisplayName(),
      reviewedById: loggedInAdmin?.id || "system",
      reviewedAt: serverTimestamp(),
    });
    
    // Create notification for resident
    if (residentId) {
      const statusMsg = newStatus === STATUS.APPROVED 
        ? "confirmed" 
        : newStatus === STATUS.REJECTED 
        ? "rejected" 
        : "reset to pending";
      
      await createNotification(
        residentId,
        `Donation ${statusMsg}`,
        `Your donation of "${donData.item || "items"}" has been ${statusMsg} by ${getAdminDisplayName()}.`,
        newStatus === STATUS.APPROVED ? "donation_confirmed" : newStatus === STATUS.REJECTED ? "donation_rejected" : "general"
      );
    }
    
    window.showAdminAlert(
      "Success",
      `Donation ${newStatus.toLowerCase()}! Resident has been notified.`,
      true,
    );
  } catch (err) {
    window.showAdminAlert("Error", "Failed to update.", false);
  } finally {
    window.hideLoading();
  }
};

// ===== LOGOUT HANDLER =====
window.triggerAdminLogoutConfirmation = function () {
  window.showConfirmPopup(
    "Terminal Disconnect?",
    "Logout from admin portal?",
    () => {
      window.showLoading();
      setTimeout(() => {
        clearAdminSession();
        loggedInAdmin = null;
        document.getElementById("login-screen")?.classList.remove("hidden");
        document.getElementById("dashboard")?.classList.add("hidden");
        document.getElementById("login-form")?.reset();
        window.hideLoading();
      }, 800);
    },
  );
};

// ===== ANNOUNCEMENTS LISTENER =====
onSnapshot(
  query(collection(db, "announcements"), orderBy("createdAt", "desc")),
  (snapshot) => {
    const container = document.getElementById("announcements-container");
    if (!container) return;
    if (snapshot.empty) {
      container.innerHTML =
        '<div class="text-center py-10 text-stone-400 bg-white border rounded-xl">No announcements posted yet.</div>';
      return;
    }
    let html = "";
    snapshot.forEach((docSnap) => {
      const a = docSnap.data(),
        id = docSnap.id;
      let pc = "bg-stone-100 text-stone-800";
      if (a.priority === "Important") pc = "bg-amber-100 text-amber-800";
      if (a.priority === "Emergency") pc = "bg-red-100 text-red-800";
      html += `<div class="bg-white p-5 rounded-xl border flex justify-between items-start shadow-sm card"><div class="flex-1"><div class="flex items-center space-x-2 mb-2"><span class="text-xs font-bold uppercase px-2 py-0.5 rounded ${pc}">${a.priority || "Notice"}</span><span class="text-xs text-stone-400"><i class="fa-solid fa-clock mr-1"></i>${formatFirebaseTimestamp(a.createdAt)}</span></div><h3 class="font-bold text-stone-900 mt-2">${a.title || ""}</h3><p class="text-sm text-stone-600 mt-1">${a.desc || ""}</p><p class="text-xs text-stone-400 mt-2">Posted by: ${a.createdBy || "Admin"}</p></div><button onclick="deleteAnnouncement('${id}')" class="ml-4 text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded hover:bg-red-600 hover:text-white transition-colors"><i class="fa-solid fa-trash mr-1"></i>Delete</button></div>`;
    });
    container.innerHTML = html;
  },
);

// ===== EVENTS LISTENER (WITH EDIT BUTTON) =====
onSnapshot(
  query(collection(db, "events"), orderBy("date", "asc")),
  (snapshot) => {
    const grid = document.getElementById("events-grid");
    if (!grid) return;
    if (snapshot.empty) {
      grid.innerHTML =
        '<div class="col-span-full text-center py-10 text-stone-400 bg-white border rounded-xl">No events created yet.</div>';
      return;
    }
    let html = "";
    snapshot.forEach((docSnap) => {
      const ev = docSnap.data(),
        id = docSnap.id;
      const escT = (ev.title || "").replace(/'/g, "\\'"),
        escL = (ev.location || "").replace(/'/g, "\\'"),
        escD = (ev.desc || "").replace(/'/g, "\\'").replace(/\n/g, "<br>");
      const dateDisplay = ev.date || "TBA",
        timeDisplay = ev.time ? formatTime(ev.time) : "";
      const hasImage = ev.imageUrl && ev.imageUrl !== "";
      const imageSection = hasImage
        ? `<div class="h-40 overflow-hidden rounded-t-xl"><img src="${ev.imageUrl}" alt="${escT}" class="w-full h-full object-cover"></div>`
        : "";

      html += `<div class="bg-white rounded-xl border border-stone-200 shadow-sm flex flex-col group card overflow-hidden">${imageSection}<div class="p-5 flex flex-col flex-1"><span class="text-[10px] font-bold uppercase bg-victoria-light text-victoria-blue px-2.5 py-1 rounded-md mb-2 inline-block w-fit">${ev.type || ev.category || "Event"}</span><h3 class="text-base font-bold text-stone-900">${ev.title || ""}</h3><p class="text-xs text-stone-500 mt-1"><i class="fa-solid fa-calendar mr-1"></i>${dateDisplay}${timeDisplay ? ` <span class="ml-2"><i class="fa-solid fa-clock mr-1"></i>${timeDisplay}</span>` : ""}</p><p class="text-xs text-stone-500 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${ev.location || "TBA"}</p><p class="text-xs text-stone-400 mt-1">By: ${ev.createdBy || "Admin"}</p><div class="flex space-x-2 mt-auto pt-3"><button onclick="openAdminEventDetails('${escT}','${dateDisplay}','${timeDisplay}','${escL}','${escD}')" class="flex-1 text-xs bg-white border font-bold py-2 rounded-lg"><i class="fa-solid fa-eye mr-1"></i>View</button><button onclick="event.stopPropagation();openEditEventModal('${id}')" class="text-xs bg-amber-50 text-amber-600 font-bold py-2 px-3 rounded-lg hover:bg-amber-600 hover:text-white transition-all"><i class="fa-solid fa-edit"></i></button><button onclick="event.stopPropagation();deleteEvent('${id}')" class="text-xs bg-red-50 text-red-600 font-bold py-2 px-3 rounded-lg hover:bg-red-600 hover:text-white transition-all"><i class="fa-solid fa-trash"></i></button></div></div></div>`;
    });
    grid.innerHTML = html;
  },
);

// ===== EVENT DETAILS MODAL =====
window.openAdminEventDetails = function (title, date, time, location, desc) {
  const mT = document.getElementById("admin-modal-event-title"),
    mD = document.getElementById("admin-modal-event-date"),
    mL = document.getElementById("admin-modal-event-location"),
    mDesc = document.getElementById("admin-modal-event-desc");
  if (!mT || !mD || !mL || !mDesc) return;
  mT.innerText = title;
  mD.innerHTML = `<i class="fa-solid fa-calendar mr-2"></i>Date: ${date}${time ? ` at ${time}` : ""}`;
  mL.innerHTML = `<i class="fa-solid fa-location-dot mr-2"></i>Location: ${location}`;
  mDesc.innerHTML = desc;
  window.toggleModal("admin-view-event-modal");
};

// ===== VOLUNTEERS LISTENER =====
onSnapshot(
  query(collection(db, "volunteers"), orderBy("createdAt", "desc")),
  (snapshot) => {
    const tbody = document.getElementById("admin-volunteers-tbody");
    if (!tbody) return;
    if (snapshot.empty) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="px-4 py-6 text-center text-sm text-stone-400">No volunteer applications yet.</td></tr>';
      return;
    }
    let html = "";
    snapshot.forEach((docSnap) => {
      const v = docSnap.data(),
        id = docSnap.id;
      
      // Status badge
      let sb = "";
      if (v.status === STATUS.APPROVED)
        sb = '<span class="badge-success px-2 py-0.5 rounded text-xs font-bold">Approved</span>';
      else if (v.status === STATUS.REJECTED)
        sb = '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold">Rejected</span>';
      else
        sb = '<span class="badge-warning px-2 py-0.5 rounded text-xs font-bold">Pending</span>';

      // Skills display
      const skillsDisplay = v.skills || "N/A";
      const experienceDisplay = v.experience ? `<span class="text-xs text-stone-500">(${v.experience})</span>` : "";
      
      // Verification file
      let verificationDisplay = '<span class="text-xs text-stone-400">No proof uploaded</span>';
      if (v.verificationFile && v.verificationFile.data) {
        verificationDisplay = `
          <button onclick="viewVerificationFile('${id}')" 
            class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-600 hover:text-white transition-all flex items-center space-x-1">
            <i class="fa-solid fa-file-circle-check"></i>
            <span>View Proof</span>
          </button>
          <span class="text-[10px] text-stone-400 block mt-1">${v.verificationFile.fileName || 'File'}</span>
        `;
      }

      // Notes display
      const notesDisplay = v.notes ? 
        `<button onclick="viewVolunteerNotes('${(v.notes || "").replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "<br>")}', '${(v.name || "Volunteer").replace(/'/g, "\\'")}')" 
          class="text-xs bg-amber-50 text-amber-600 px-2 py-1 rounded hover:bg-amber-600 hover:text-white transition-all">
          <i class="fa-solid fa-note-sticky mr-1"></i>Notes
        </button>` : "";

      // Actions
      let actionsHtml = '<div class="flex space-x-1 flex-wrap gap-1">';
      if (v.status === STATUS.PENDING) {
        actionsHtml += `<button onclick="updateVolunteerStatus('${id}','${STATUS.APPROVED}')" class="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-600 hover:text-white" title="Approve"><i class="fa-solid fa-check"></i> Approve</button>`;
        actionsHtml += `<button onclick="updateVolunteerStatus('${id}','${STATUS.REJECTED}')" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-600 hover:text-white" title="Reject"><i class="fa-solid fa-xmark"></i> Reject</button>`;
      }
      if (v.status !== STATUS.PENDING) {
        actionsHtml += `<button onclick="updateVolunteerStatus('${id}','${STATUS.PENDING}')" class="text-xs bg-amber-50 text-amber-600 px-2 py-1 rounded hover:bg-amber-600 hover:text-white" title="Reset to Pending"><i class="fa-solid fa-rotate"></i> Reset</button>`;
      }
      actionsHtml += '</div>';

      html += `<tr class="hover:bg-stone-50 border-b table-row">
        <td class="px-4 py-4">
          <div class="font-bold text-stone-900">${v.name || "N/A"}</div>
          <div class="text-xs text-stone-500">${v.email || "N/A"}</div>
          ${notesDisplay ? `<div class="mt-1">${notesDisplay}</div>` : ""}
        </td>
        <td class="px-4 py-4 text-sm text-stone-600">${v.phone || v.phone || "N/A"}</td>
        <td class="px-4 py-4">
          <div class="text-sm font-semibold text-stone-800">${skillsDisplay}</div>
          <div class="text-xs text-stone-500">${experienceDisplay}</div>
        </td>
        <td class="px-4 py-4 text-sm text-stone-600">${v.availability || "N/A"}</td>
        <td class="px-4 py-4">${verificationDisplay}</td>
        <td class="px-4 py-4">${sb}</td>
        <td class="px-4 py-4">${actionsHtml}</td>
      </tr>`;
    });
    tbody.innerHTML = html;
  },
);

// ===== VIEW VERIFICATION FILE (UPDATED - Supports all file types) =====
window.viewVerificationFile = async function(volunteerId) {
  window.showLoading();
  try {
    const docSnap = await getDoc(doc(db, "volunteers", volunteerId));
    if (!docSnap.exists()) {
      window.hideLoading();
      window.showAdminAlert("Error", "Volunteer record not found.", false);
      return;
    }
    
    const data = docSnap.data();
    if (!data.verificationFile || !data.verificationFile.data) {
      window.hideLoading();
      window.showAdminAlert("No File", "No verification document was uploaded for this volunteer.", false);
      return;
    }
    
    const fileData = data.verificationFile.data;
    const fileName = data.verificationFile.fileName || "verification-file";
    const fileType = data.verificationFile.fileType || "application/octet-stream";
    const uploadedAt = data.verificationFile.uploadedAt 
      ? new Date(data.verificationFile.uploadedAt).toLocaleString() 
      : "Unknown date";
    
    // Create modal to display the file
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-[180]";
    modal.id = "verification-viewer-modal";
    modal.onclick = function(e) { if (e.target === this) this.remove(); };
    
    let contentHtml = "";
    
    // Get file extension from filename or fileType
    const fileExtension = fileName.split('.').pop().toLowerCase();
    
    // Check if it's an image (PNG, JPG, JPEG, GIF, WEBP, SVG, BMP, etc.)
    if (fileType.startsWith("image/") || 
        ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'].includes(fileExtension)) {
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (Image)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl p-4 flex items-center justify-center">
              <img src="${fileData}" alt="${fileName}" class="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md">
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-image mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <div class="flex space-x-3 mt-4">
              <a href="${fileData}" download="${fileName}" 
                class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                <i class="fa-solid fa-download mr-1.5"></i>Download Image
              </a>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" 
                class="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>`;
    } 
    // Check if it's a PDF
    else if (fileType === "application/pdf" || fileExtension === 'pdf') {
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (PDF)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl overflow-hidden" style="height: 70vh;">
              <embed src="${fileData}" type="application/pdf" width="100%" height="100%" class="rounded-lg">
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-pdf mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <div class="flex space-x-3 mt-4">
              <a href="${fileData}" download="${fileName}" 
                class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                <i class="fa-solid fa-download mr-1.5"></i>Download PDF
              </a>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" 
                class="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>`;
    }
    // Check if it's a DOCX, DOC, or other document
    else if (fileType.includes("word") || 
             fileType.includes("document") || 
             ['doc', 'docx'].includes(fileExtension)) {
      // For DOCX/DOC files, use Google Docs Viewer
      const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileData)}&embedded=true`;
      
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (Word)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl p-4 text-center">
              <i class="fa-solid fa-file-word text-5xl text-blue-600 mb-4"></i>
              <p class="text-sm text-stone-600 mb-4">Microsoft Word Document</p>
              <p class="text-xs text-stone-500 mb-4">Preview may not be available for all document types. You can download the file or try Google Docs Viewer.</p>
              <div class="flex space-x-3 mb-4">
                <a href="${fileData}" download="${fileName}" 
                  class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                  <i class="fa-solid fa-download mr-1.5"></i>Download ${fileExtension.toUpperCase()}
                </a>
              </div>
            </div>
            <div class="bg-gray-100 rounded-xl overflow-hidden" style="height: 50vh;">
              <iframe src="${googleDocsUrl}" width="100%" height="100%" class="rounded-lg" 
                onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
              </iframe>
              <div style="display: none;" class="text-center py-8">
                <i class="fa-solid fa-eye-slash text-4xl text-stone-400 mb-3"></i>
                <p class="text-sm text-stone-600">Preview not available</p>
                <p class="text-xs text-stone-500">Google Docs Viewer may not support this file</p>
              </div>
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-word mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <button onclick="document.getElementById('verification-viewer-modal').remove()" 
              class="mt-4 w-full bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>`;
    }
    // Check if it's an Excel file
    else if (fileType.includes("excel") || 
             fileType.includes("spreadsheet") || 
             ['xls', 'xlsx', 'csv'].includes(fileExtension)) {
      // For Excel files, use Google Docs Viewer
      const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileData)}&embedded=true`;
      
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (Excel)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl p-4 text-center mb-4">
              <i class="fa-solid fa-file-excel text-5xl text-green-600 mb-4"></i>
              <p class="text-sm text-stone-600 mb-4">Microsoft Excel Spreadsheet</p>
              <div class="flex space-x-3">
                <a href="${fileData}" download="${fileName}" 
                  class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                  <i class="fa-solid fa-download mr-1.5"></i>Download ${fileExtension.toUpperCase()}
                </a>
              </div>
            </div>
            <div class="bg-gray-100 rounded-xl overflow-hidden" style="height: 50vh;">
              <iframe src="${googleDocsUrl}" width="100%" height="100%" class="rounded-lg">
              </iframe>
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-excel mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <button onclick="document.getElementById('verification-viewer-modal').remove()" 
              class="mt-4 w-full bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>`;
    }
    // Check if it's a PowerPoint file
    else if (fileType.includes("presentation") || 
             fileType.includes("powerpoint") || 
             ['ppt', 'pptx'].includes(fileExtension)) {
      // For PowerPoint files, use Google Docs Viewer
      const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileData)}&embedded=true`;
      
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (PowerPoint)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl p-4 text-center mb-4">
              <i class="fa-solid fa-file-powerpoint text-5xl text-orange-600 mb-4"></i>
              <p class="text-sm text-stone-600 mb-4">Microsoft PowerPoint Presentation</p>
              <div class="flex space-x-3">
                <a href="${fileData}" download="${fileName}" 
                  class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                  <i class="fa-solid fa-download mr-1.5"></i>Download ${fileExtension.toUpperCase()}
                </a>
              </div>
            </div>
            <div class="bg-gray-100 rounded-xl overflow-hidden" style="height: 50vh;">
              <iframe src="${googleDocsUrl}" width="100%" height="100%" class="rounded-lg">
              </iframe>
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-powerpoint mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <button onclick="document.getElementById('verification-viewer-modal').remove()" 
              class="mt-4 w-full bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>`;
    }
    // Check if it's a text file
    else if (fileType.startsWith("text/") || 
             ['txt', 'rtf'].includes(fileExtension)) {
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-lg font-extrabold text-victoria-blue">Verification Document (Text)</h3>
                <p class="text-xs text-stone-500">Uploaded by: ${data.name || "Volunteer"} on ${uploadedAt}</p>
              </div>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
                <i class="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div class="bg-gray-100 rounded-xl overflow-hidden" style="height: 70vh;">
              <iframe src="${fileData}" width="100%" height="100%" class="rounded-lg bg-white"></iframe>
            </div>
            <div class="mt-4 flex items-center justify-between text-xs text-stone-500">
              <span><i class="fa-solid fa-file-lines mr-1"></i>${fileName}</span>
              <span><i class="fa-solid fa-clock mr-1"></i>${uploadedAt}</span>
            </div>
            <div class="flex space-x-3 mt-4">
              <a href="${fileData}" download="${fileName}" 
                class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                <i class="fa-solid fa-download mr-1.5"></i>Download File
              </a>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" 
                class="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>`;
    }
    // For all other file types (ZIP, RAR, etc.)
    else {
      contentHtml = `
        <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 modal-enter">
          <div class="p-6 text-center">
            <div class="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">
              <i class="fa-solid fa-file-lines"></i>
            </div>
            <h3 class="text-lg font-extrabold text-victoria-blue mb-2">Document Available</h3>
            <p class="text-sm text-stone-500 mb-1">File: <span class="font-semibold text-stone-700">${fileName}</span></p>
            <p class="text-xs text-stone-400 mb-1">Type: ${fileType}</p>
            <p class="text-xs text-stone-400 mb-4">Uploaded by ${data.name || "Volunteer"} on ${uploadedAt}</p>
            <p class="text-xs text-stone-400 mb-4">This file type (${fileExtension.toUpperCase()}) cannot be previewed directly. Please download to view.</p>
            <div class="flex space-x-3">
              <a href="${fileData}" download="${fileName}" 
                class="flex-1 bg-victoria-blue text-white font-semibold py-2.5 rounded-xl text-sm hover:bg-victoria-accent transition-colors text-center">
                <i class="fa-solid fa-download mr-1.5"></i>Download File
              </a>
              <button onclick="document.getElementById('verification-viewer-modal').remove()" 
                class="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>`;
    }
    
    modal.innerHTML = contentHtml;
    document.body.appendChild(modal);
    window.hideLoading();
  } catch (err) {
    window.hideLoading();
    window.showAdminAlert("Error", "Failed to load verification file.", false);
  }
};

// ===== VIEW VOLUNTEER NOTES =====
window.viewVolunteerNotes = function(notes, volunteerName) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-[180]";
  modal.id = "notes-viewer-modal";
  modal.onclick = function(e) { if (e.target === this) this.remove(); };
  
  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 modal-enter">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-extrabold text-victoria-blue">Volunteer Notes</h3>
          <button onclick="document.getElementById('notes-viewer-modal').remove()" class="text-gray-400 hover:text-gray-600 p-2">
            <i class="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>
        <p class="text-xs text-stone-500 mb-3">From: <span class="font-semibold text-stone-700">${volunteerName}</span></p>
        <div class="bg-gray-50 p-4 rounded-xl border border-gray-200 max-h-60 overflow-y-auto">
          <p class="text-sm text-stone-700 leading-relaxed whitespace-pre-line">${notes}</p>
        </div>
        <button onclick="document.getElementById('notes-viewer-modal').remove()" 
          class="mt-4 w-full bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition-colors">
          Close
        </button>
      </div>
    </div>`;
  
  document.body.appendChild(modal);
};

// ===== DIGITAL CHECK-IN & HOURS LISTENERS =====
function initDigitalCheckInsListener() {
  onSnapshot(
    query(
      collection(db, "participants"),
      where("status", "in", [STATUS.REGISTERED, STATUS.COMPLETED]),
      orderBy("status", "asc"),
      orderBy("timestamp", "desc"),
    ),
    (snapshot) => {
      const select = document.getElementById("hour-participant-select");
      if (!select) return;
      select.innerHTML = "";
      digitalCheckInRegistry = [];
      
      if (snapshot.empty) {
        select.innerHTML = '<option value="">No Active Event Check-Ins Found</option>';
        return;
      }
      
      let opts = '<option value="">Select Participant...</option>';
      let hasPending = false;
      
      snapshot.forEach((docSnap) => {
        const item = docSnap.data(),
          id = docSnap.id;
        digitalCheckInRegistry.push({ id, ...item });
        
        // MODIFICATION: Only add to dropdown if their hours have NOT been credited yet
        if (item.status !== STATUS.COMPLETED) {
          hasPending = true;
          opts += `<option value="${id}">• ${item.residentName} - ${item.eventTitle || "No Title"}</option>`;
        }
      });
      
      // If all participants have been credited, update the default option message
      if (!hasPending) {
        opts = '<option value="">All participants have been credited</option>';
      }
      
      select.innerHTML = opts;
    },
  );
  onSnapshot(
    query(collection(db, "service_hours"), orderBy("certifiedAt", "desc")),
    (snapshot) => {
      const tbody = document.getElementById("admin-hours-tbody");
      if (!tbody) return;
      if (snapshot.empty) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="px-4 py-3 text-stone-400 text-center text-sm">No service hours recorded yet.</td></tr>';
        return;
      }
      let html = "";
      snapshot.forEach((docSnap) => {
        const h = docSnap.data(),
          id = docSnap.id;
        let sb = "";
        if (h.status === STATUS.APPROVED)
          sb =
            '<span class="badge-success px-2 py-0.5 rounded text-xs font-bold">✓ Approved</span>';
        else if (h.status === STATUS.REJECTED)
          sb =
            '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold">✗ Rejected</span>';
        else
          sb =
            '<span class="badge-warning px-2 py-0.5 rounded text-xs font-bold">Pending</span>';
        const cd = formatFirebaseTimestamp(
          h.certifiedAt || h.rejectedAt || h.restoredAt,
        );
        html += `<tr class="hover:bg-stone-50 border-b table-row"><td class="px-4 py-3 font-bold">${h.residentName || "N/A"}</td><td class="px-4 py-3 font-medium">${h.eventTitle || "N/A"}</td><td class="px-4 py-3 font-black">${h.hours || 0} hrs</td><td class="px-4 py-3">${sb}</td><td class="px-4 py-3 text-xs text-stone-500"><div>${h.certifiedBy || h.rejectedBy || h.restoredBy || "System"}</div><div class="text-stone-400">${cd}</div></td><td class="px-4 py-3">${h.status === STATUS.APPROVED ? `<button onclick="rejectServiceHours('${id}')" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-600 hover:text-white"><i class="fa-solid fa-xmark"></i> Reject</button>` : ""}${h.status === STATUS.REJECTED ? `<button onclick="restoreServiceHours('${id}')" class="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-600 hover:text-white"><i class="fa-solid fa-rotate"></i> Restore</button>` : ""}</td></tr>`;
      });
      tbody.innerHTML = html;
    },
  );
}

// ===== ACTIVITY LOGS LISTENER =====
function initActivityLogsListener() {
  const tbody = document.getElementById("activity-logs-tbody");
  if (!tbody) return;
  onSnapshot(
    query(collection(db, "participants"), orderBy("timestamp", "desc")),
    (snapshot) => {
      if (snapshot.empty) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="px-4 py-6 text-center text-stone-400">No activity logs yet.</td></tr>';
        return;
      }
      let html = "";
      snapshot.forEach((docSnap) => {
        const log = docSnap.data();
        let ab = "",
          sb = "",
          rs = "";
        if (log.status === STATUS.REGISTERED) {
          ab =
            '<span class="badge-success px-2 py-0.5 rounded text-xs font-bold"><i class="fa-solid fa-user-plus mr-1"></i>Registered</span>';
          sb = '<span class="text-emerald-600 text-xs font-bold">Active</span>';
          rs = "hover:bg-emerald-50/50";
        } else if (log.status === STATUS.CANCELLED) {
          ab =
            '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold"><i class="fa-solid fa-user-minus mr-1"></i>Cancelled</span>';
          sb = '<span class="text-red-600 text-xs font-bold">Cancelled</span>';
          rs = "hover:bg-red-50/50";
        } else if (log.status === STATUS.COMPLETED) {
          ab =
            '<span class="badge-info px-2 py-0.5 rounded text-xs font-bold"><i class="fa-solid fa-circle-check mr-1"></i>Completed</span>';
          sb =
            '<span class="text-blue-600 text-xs font-bold">Hours Credited</span>';
          rs = "hover:bg-blue-50/50";
        } else if (log.status === STATUS.REJECTED) {
          ab =
            '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold"><i class="fa-solid fa-user-xmark mr-1"></i>Rejected</span>';
          sb = '<span class="text-red-600 text-xs font-bold">Rejected</span>';
          rs = "hover:bg-red-50/50";
        } else {
          ab =
            '<span class="badge-warning px-2 py-0.5 rounded text-xs font-bold">Unknown</span>';
          sb = '<span class="text-amber-600 text-xs font-bold">Unknown</span>';
          rs = "hover:bg-stone-50";
        }
        const ts = log.timestamp?.toDate
          ? log.timestamp.toDate()
          : new Date(log.timestamp || Date.now());
        const fd = ts.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        const ft = ts.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        html += `<tr class="border-b ${rs} activity-log-row" data-status="${log.status || "unknown"}"><td class="px-4 py-3 font-bold">${log.residentName || "N/A"}</td><td class="px-4 py-3 font-medium">${log.eventTitle || "N/A"}</td><td class="px-4 py-3">${ab}</td><td class="px-4 py-3"><div class="text-xs">${fd}</div><div class="text-xs text-stone-500">${ft}</div></td><td class="px-4 py-3">${sb}</td></tr>`;
      });
      tbody.innerHTML = html;
    },
  );
}
window.filterActivityLogs = function (filter) {
  document.querySelectorAll(".activity-filter-btn").forEach((b) => {
    b.className =
      b.getAttribute("data-filter") === filter
        ? "activity-filter-btn active text-xs px-4 py-2 rounded-lg font-semibold"
        : "activity-filter-btn text-xs px-4 py-2 rounded-lg font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all";
  });
  document.querySelectorAll(".activity-log-row").forEach((r) => {
    r.style.display =
      filter === "all"
        ? ""
        : r.getAttribute("data-status") === filter
          ? ""
          : "none";
  });
};

// ===== DONATIONS LISTENER =====
onSnapshot(
  query(collection(db, "donations"), orderBy("createdAt", "desc")),
  (snapshot) => {
    const tbody = document.getElementById("admin-donations-tbody");
    if (!tbody) return;
    if (snapshot.empty) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="px-4 py-6 text-center text-stone-400">No donations reported yet.</td></tr>';
      return;
    }
    let html = "";
    snapshot.forEach((docSnap) => {
      const d = docSnap.data(),
        id = docSnap.id;
      let sb = "";
      if (d.status === STATUS.APPROVED || d.status === STATUS.CONFIRMED)
        sb =
          '<span class="badge-success px-2 py-0.5 rounded text-xs font-bold">✓ Confirmed</span>';
      else if (d.status === STATUS.REJECTED)
        sb =
          '<span class="badge-danger px-2 py-0.5 rounded text-xs font-bold">✗ Rejected</span>';
      else
        sb =
          '<span class="badge-warning px-2 py-0.5 rounded text-xs font-bold">Pending</span>';
      
      const amountDisplay = d.amount ? `₱${parseFloat(d.amount).toLocaleString()}` : d.item || "N/A";
      
      html += `<tr class="hover:bg-stone-50 border-b table-row"><td class="px-5 py-4 font-bold">${d.donorName || "Anonymous"}</td><td class="px-5 py-4 font-bold text-emerald-800">${amountDisplay}</td><td class="px-5 py-4 text-sm">${d.purpose || "N/A"}</td><td class="px-5 py-4">${sb}</td><td class="px-5 py-4"><div class="flex space-x-1 flex-wrap gap-1">${d.status !== STATUS.APPROVED && d.status !== STATUS.CONFIRMED ? `<button onclick="updateDonationStatus('${id}','${STATUS.APPROVED}')" class="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded hover:bg-emerald-600 hover:text-white"><i class="fa-solid fa-check"></i> Confirm</button>` : ""}${d.status !== STATUS.REJECTED ? `<button onclick="updateDonationStatus('${id}','${STATUS.REJECTED}')" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-600 hover:text-white"><i class="fa-solid fa-xmark"></i> Reject</button>` : ""}${d.status !== STATUS.PENDING ? `<button onclick="updateDonationStatus('${id}','${STATUS.PENDING}')" class="text-xs bg-amber-50 text-amber-600 px-2 py-1 rounded hover:bg-amber-600 hover:text-white"><i class="fa-solid fa-rotate"></i> Reset</button>` : ""}</div></td></tr>`;
    });
    tbody.innerHTML = html;
  },
);

// ===== DELETE FUNCTIONS =====
window.deleteEvent = function (id) {
  window.showConfirmPopup(
    "Delete Event?",
    "This will also remove all related registrations.",
    async () => {
      window.showLoading();
      try {
        await deleteDoc(doc(db, "events", id));
        const ps = await getDocs(
          query(collection(db, "participants"), where("eventId", "==", id)),
        );
        const b = writeBatch(db);
        ps.forEach((d) => b.delete(d.ref));
        await b.commit();
        window.showAdminAlert("Success", "Event deleted.", true);
      } catch (e) {
        window.showAdminAlert("Error", e.message, false);
      } finally {
        window.hideLoading();
      }
    },
  );
};
window.deleteAnnouncement = function (id) {
  window.showConfirmPopup("Delete?", "Delete this announcement?", async () => {
    window.showLoading();
    try {
      await deleteDoc(doc(db, "announcements", id));
      window.showAdminAlert("Success", "Deleted.", true);
    } catch (e) {
      window.showAdminAlert("Error", e.message, false);
    } finally {
      window.hideLoading();
    }
  });
};

// ===== SWITCH TAB FUNCTION =====
window.switchTab = function (tabId) {
  window.showLoading();
  setTimeout(() => {
    document
      .querySelectorAll(".tab-content")
      .forEach((el) => el.classList.add("hidden"));
    const target = document.getElementById(tabId);
    if (target) target.classList.remove("hidden");
    document.querySelectorAll(".nav-link").forEach((b) => {
      b.className =
        "nav-link w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm text-gray-300 hover:bg-victoria-blue/50 transition-all";
    });
    const active = Array.from(document.querySelectorAll(".nav-link")).find(
      (b) => b.getAttribute("onclick")?.includes(tabId),
    );
    if (active)
      active.className =
        "nav-link w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm bg-victoria-blue text-victoria-gold border border-victoria-gold/20 font-bold";
    saveActiveTab(tabId);
    window.hideLoading();
  }, 400);
};

// ===== CREATE TEST ADMIN =====
async function createTestAdmin() {
  try {
    const q = query(
      collection(db, "admins"),
      where("email", "==", "admin@barangay.gov.ph"),
    );
    const s = await getDocs(q);
    if (s.empty)
      await addDoc(collection(db, "admins"), {
        email: "admin@barangay.gov.ph",
        password: "admin123",
        role: "super_admin",
        name: "Super Admin",
        createdAt: serverTimestamp(),
      });
  } catch (e) { }
}

// Export for testing
window.createTestAdmin = createTestAdmin;
window.updateVolunteerStatus = window.updateVolunteerStatus;
window.rejectServiceHours = window.rejectServiceHours;
window.restoreServiceHours = window.restoreServiceHours;
window.bulkApproveVolunteers = window.bulkApproveVolunteers;
window.updateDonationStatus = window.updateDonationStatus;
window.getAdminDisplayName = getAdminDisplayName;
window.filterActivityLogs = window.filterActivityLogs;
window.openEditEventModal = window.openEditEventModal;
window.createNotification = createNotification;