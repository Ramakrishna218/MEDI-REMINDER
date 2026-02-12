// ==========================
// Backend API Configuration
// ==========================

// Change this if your backend is served from a different host/port.
const API_BASE_URL = 'http://127.0.0.1:8000';

function getAccessToken() {
    return localStorage.getItem('access_token');
}

async function apiRequest(path, options = {}) {
    const token = getAccessToken();

    const defaultHeaders = {
        'Content-Type': 'application/json'
    };

    const mergedHeaders = {
        ...defaultHeaders,
        ...(options.headers || {})
    };

    if (token) {
        mergedHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers: mergedHeaders,
        body: options.body || null
    });

    if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
            const data = await response.json();
            if (data && data.detail) {
                errorMessage = Array.isArray(data.detail)
                    ? data.detail.map(d => d.msg || d).join(', ')
                    : data.detail;
            }
        } catch {
            // ignore JSON parse errors
        }
        throw new Error(errorMessage);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

// ==========================
// Auth & User Helpers
// ==========================

// Toggle Password Visibility
function togglePassword(inputId, iconElement) {
    const input = document.getElementById(inputId);
    if (input && input.type === "password") {
        input.type = "text";
        iconElement.classList.remove('fa-eye');
        iconElement.classList.add('fa-eye-slash');
    } else if (input) {
        input.type = "password";
        iconElement.classList.remove('fa-eye-slash');
        iconElement.classList.add('fa-eye');
    }
}

// User Data & Personalization
function loadUserData() {
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem('currentUser'));
    } catch (e) {
        console.error("Error parsing user data", e);
    }

    if (!currentUser) return; // No user logged in (or first visit)

    const metadata = currentUser.user_metadata || {};

    const displayName =
        metadata.username ||
        metadata.full_name ||
        currentUser.username ||
        currentUser.email ||
        currentUser.phone ||
        'User';

    const email =
        currentUser.email ||
        metadata.email ||
        '';

    const joined =
        metadata.joined ||
        currentUser.joined ||
        null;

    // Dashboard Personalization
    const greetingText = document.querySelector('.greeting-text');
    const userNameElement = document.querySelector('.user-name');
    const dateElement = document.querySelector('.current-date');

    if (greetingText) greetingText.textContent = "Welcome,";
    if (userNameElement) userNameElement.textContent = displayName;

    // Hide the date element as per previous requirement
    if (dateElement) dateElement.style.display = 'none';

    // Settings Personalization
    const profileName = document.querySelector('.profile-details h3');
    const profileEmail = document.querySelector('.profile-details .email');
    const profileJoined = document.querySelector('.profile-details .joined');

    if (profileName) profileName.textContent = displayName;
    if (profileEmail) profileEmail.textContent = email;
    if (joined && profileJoined) {
        profileJoined.textContent = `Member since ${joined}`;
    }
}

// ==========================
// Medication Management Logic
// ==========================

// Medication time formatting helper
function formatTime(timeStr) {
    if (!timeStr) return '';
    const [hour, minute] = timeStr.split(':');
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m < 10 ? '0' + m : m} ${ampm}`;
}

// Global function used by add-medication.html
async function saveMedicationFromForm() {
    const name = document.getElementById('medName').value;
    const dosage = document.getElementById('medDosage').value;
    const frequency = document.getElementById('medFrequency').value;
    const time = document.getElementById('medTime').value;
    const instructions = document.getElementById('medInstructions').value;

    if (!getAccessToken()) {
        alert('Please log in before saving medications.');
        window.location.href = 'index.html';
        return;
    }

    const payload = {
        name,
        dosage,
        frequency,
        time,
        instructions: instructions || null,
        active: true,
        start_date: new Date().toISOString().split('T')[0]
    };

    try {
        await apiRequest('/medicines', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        alert('Medication saved successfully!');
        window.location.href = 'my-medications.html';
    } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to save medication. Please try again.');
    }
}

// Render Medications on My Medications Page (from backend)
async function renderMedications() {
    const listContainer = document.getElementById('medicationList');
    if (!listContainer) return;

    // Keep existing static items for design, and prepend dynamic ones
    try {
        const meds = await apiRequest('/medicines');
        if (!Array.isArray(meds)) return;

        meds.forEach(med => {
            const card = document.createElement('div');
            card.className = 'med-list-card';
            const timeDisplay = med.time ? formatTime(med.time) : '';
            const isActive = med.active !== false;
            const startDate = med.start_date || '';

            card.innerHTML = `
                <div class="med-card-top">
                    <div class="med-icon-box teal-light">
                        <i class="ri-capsule-line"></i>
                    </div>
                    <div class="med-info">
                        <h4>${med.name}</h4>
                        <p>${med.dosage} &middot; ${med.frequency}</p>
                    </div>
                    <button class="more-options"><i class="ri-more-2-fill"></i></button>
                </div>
                <div class="med-card-middle">
                    <div class="tag time-tag"><i class="ri-time-line"></i> ${timeDisplay}</div>
                    <div class="tag status-tag ${isActive ? 'active' : ''}">
                        <i class="ri-check-line"></i> ${isActive ? 'Active' : 'Inactive'}
                    </div>
                </div>
                <div class="med-card-bottom">
                    <span>${med.instructions || 'No special instructions'}</span>
                    <span class="refill-info">Added: ${startDate}</span>
                </div>
            `;
            listContainer.insertBefore(card, listContainer.firstChild);
        });
    } catch (err) {
        console.error('Failed to load medications from server', err);
        // Optional: you can show a message in the UI here.
    }
}

// ==========================
// Caregivers Management Logic
// ==========================

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function appendCaregiverCard(caregiver, listContainer) {
    const container = listContainer || document.getElementById('contactList');
    if (!container || !caregiver) return;

    const card = document.createElement('div');
    card.className = 'contact-card';

    const initials = getInitials(caregiver.name);
    const role = caregiver.relation || 'Caregiver';
    const hasStar = caregiver.is_primary === true;

    const phone = caregiver.phone || '';
    const email = caregiver.email || '';

    const phoneLink = phone ? `tel:${phone}` : '#';
    const emailLink = email ? `mailto:${email}` : '#';

    card.innerHTML = `
        <div class="contact-card-top">
            <div class="avatar-circle-md">${initials}</div>
            <div class="contact-details">
                <div class="name-row">
                    <h4>${caregiver.name}</h4>
                    ${hasStar ? '<i class="ri-star-fill star-icon"></i>' : ''}
                </div>
                <span class="role-badge">${role}</span>
            </div>
            <button class="more-options"><i class="ri-more-2-fill"></i></button>
        </div>
        <div class="contact-actions">
            ${phone ? `<a href="${phoneLink}" class="btn-outline-action"><i class="ri-phone-line"></i> Call</a>` : ''}
            ${email ? `<a href="${emailLink}" class="btn-outline-action"><i class="ri-mail-line"></i> Email</a>` : ''}
        </div>
    `;

    container.insertBefore(card, container.firstChild);
}

// Load caregivers for the logged-in user and render them
async function renderCaregivers() {
    const listContainer = document.getElementById('contactList');
    if (!listContainer) return;
    if (!getAccessToken()) return;

    try {
        const caregivers = await apiRequest('/caregivers');
        if (!Array.isArray(caregivers)) return;
        caregivers.forEach(cg => appendCaregiverCard(cg, listContainer));
    } catch (err) {
        console.error('Failed to load caregivers from server', err);
    }
}

// ==========================
// Alarm & Audio Logic (Web Audio API)
// ==========================

let audioContext = null;
let alarmInterval = null;
let isAlarmPlaying = false;

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playAlarmSound() {
    initAudioContext();
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    // Stop previous if running
    if (isAlarmPlaying) return;
    isAlarmPlaying = true;

    // Pattern: Beep-Beep-Beep every 3 seconds
    // 880Hz (A5) and 1047Hz (C6) for pleasant alert

    // Helper to play a single beep
    const playBeep = (freq, startTime, duration) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(audioContext.destination);

        // Envelope for smooth sound
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        osc.start(startTime);
        osc.stop(startTime + duration);
    };

    const scheduleBeeps = () => {
        if (!isAlarmPlaying) return;
        const now = audioContext.currentTime;
        // Beep 1
        playBeep(880, now, 0.2);
        playBeep(1047, now, 0.2);
        // Beep 2
        playBeep(880, now + 0.3, 0.2);
        playBeep(1047, now + 0.3, 0.2);
        // Beep 3
        playBeep(880, now + 0.6, 0.4); // Longer last beep
        playBeep(1047, now + 0.6, 0.4);
    };

    // Initial play
    scheduleBeeps();

    // Repeat every 3 seconds
    alarmInterval = setInterval(() => {
        if (isAlarmPlaying) scheduleBeeps();
    }, 3000);
}

async function updateCurrentAlarmStatus(newStatus) {
    const raw = localStorage.getItem('currentAlarm');
    if (!raw) return;

    let alarm;
    try {
        alarm = JSON.parse(raw);
    } catch {
        return;
    }

    if (!alarm || alarm.id == null) return;
    if (!getAccessToken()) return;

    try {
        const updated = await apiRequest(`/alarms/${alarm.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        localStorage.setItem('currentAlarm', JSON.stringify(updated));
    } catch (err) {
        console.error('Failed to update alarm status', err);
    }
}

async function stopAlarmAndRedirect() {
    isAlarmPlaying = false;
    if (alarmInterval) clearInterval(alarmInterval);
    await updateCurrentAlarmStatus('taken');
    // Redirect back to dashboard
    window.location.href = 'dashboard.html';
}

async function stopAlarmOnly() {
    isAlarmPlaying = false;
    if (alarmInterval) clearInterval(alarmInterval);
    await updateCurrentAlarmStatus('snoozed');
}

// Hook to check for alarms via backend `/alarms`
async function checkMedicationAlarms() {
    if (!getAccessToken()) return;

    const now = new Date();
    const currentHHMM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    try {
        const alarms = await apiRequest('/alarms');
        if (!Array.isArray(alarms)) return;

        const dueAlarm = alarms.find(a =>
            a.scheduled_time === currentHHMM &&
            (!a.status || a.status === 'upcoming')
        );

        if (dueAlarm) {
            localStorage.setItem('currentAlarm', JSON.stringify(dueAlarm));
            window.location.href = 'alarm.html';
        }
    } catch (err) {
        console.error('Failed to check alarms from server', err);
    }
}

// Check every 10 seconds
setInterval(checkMedicationAlarms, 10000);

// ==========================
// Dynamic Calendar Logic
// ==========================

const CalendarManager = {
    currentDate: new Date(),
    selectedDate: new Date(),

    init() {
        if (!document.getElementById('calendarGrid')) return;

        this.renderCalendar();
        this.attachEventListeners();
        this.updateScheduleDisplay(this.selectedDate);
    },

    attachEventListeners() {
        const navBtns = document.querySelectorAll('.cal-nav-btn');
        if (navBtns.length >= 2) {
            navBtns[0].addEventListener('click', () => this.changeMonth(-1));
            navBtns[1].addEventListener('click', () => this.changeMonth(1));
        }
    },

    changeMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.renderCalendar();
    },

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // Update Header
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const monthHeader = document.querySelector('.current-month');
        if (monthHeader) {
            monthHeader.textContent = `${monthNames[month]} ${year}`;
        }

        const grid = document.getElementById('calendarGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        // Previous Month Padding
        for (let i = 0; i < firstDay; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'cal-day other-month';
            dayDiv.textContent = daysInPrevMonth - firstDay + 1 + i;
            grid.appendChild(dayDiv);
        }

        // Current Month Days
        const today = new Date();

        for (let i = 1; i <= daysInMonth; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'cal-day';
            dayDiv.textContent = i;

            // Check if selected
            if (i === this.selectedDate.getDate() &&
                month === this.selectedDate.getMonth() &&
                year === this.selectedDate.getFullYear()) {
                dayDiv.classList.add('active');
            }

            // Check details for dots (simulated logic)
            const checkDate = new Date(year, month, i);
            if (checkDate < today && i % 5 === 0) { // arbitrary rule for demo
                dayDiv.classList.add('has-missed');
                const dot = document.createElement('span');
                dot.className = 'dot red';
                dayDiv.appendChild(dot);
            }

            dayDiv.addEventListener('click', () => {
                this.selectedDate = new Date(year, month, i);
                this.renderCalendar(); // Re-render to update active state
                this.updateScheduleDisplay(this.selectedDate);
            });

            grid.appendChild(dayDiv);
        }
    },

    updateScheduleDisplay(date) {
        const header = document.querySelector('.schedule-header h3');
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        if (header) header.textContent = date.toLocaleDateString('en-US', options);

        // Update progress text (Mock)
        const progress = document.querySelector('.schedule-header p');
        if (progress) {
            // Random progress for demo
            const total = 6;
            const taken = Math.floor(Math.random() * (total + 1));
            progress.textContent = `${taken} of ${total} taken`;
        }

        // Render schedule list (Mock data based on odd/even days)
        const list = document.querySelector('.schedule-list');
        if (!list) return;

        list.innerHTML = '';

        // Mock data generator
        const meds = [
            { name: "Lisinopril", dose: "10mg", time: "8:00 AM" },
            { name: "Metformin", dose: "500mg", time: "8:00 AM" },
            { name: "Atorvastatin", dose: "20mg", time: "1:00 PM" },
            { name: "Aspirin", dose: "81mg", time: "1:00 PM" },
            { name: "Amlodipine", dose: "5mg", time: "8:00 PM" },
            { name: "Omeprazole", dose: "20mg", time: "8:00 PM" }
        ];

        meds.forEach((med, index) => {
            // Determine status based on index and randomness for demo
            let status = 'upcoming';
            let statusText = 'Upcoming';
            let iconClass = 'ri-time-line';
            let iconColor = 'orange';

            // Make some 'Taken' if past time or random
            if (index < 2) {
                status = 'taken';
                statusText = 'Taken';
                iconClass = 'ri-check-line';
                iconColor = ''; // default teal from css
            } else if (index === 2 && date.getDate() % 5 === 0) {
                status = 'missed';
                statusText = 'Missed';
                iconClass = 'ri-error-warning-line';
                iconColor = ''; // css handles red
            }

            const item = document.createElement('div');
            item.className = `schedule-item ${status}`;
            item.innerHTML = `
                <div class="status-icon-box ${iconColor}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="item-details">
                    <h4>${med.name}</h4>
                    <p>${med.dose} &middot; ${med.time}</p>
                </div>
                <span class="status-badge ${status}">${statusText}</span>
            `;
            list.appendChild(item);
        });
    }
};

// Initialize Calendar if on page
document.addEventListener('DOMContentLoaded', () => {
    CalendarManager.init();
});

// ==========================
// Global Initialisation (Auth, Forms, etc.)
// ==========================

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    // Login Handler (uses backend)
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('identifier').value.trim();
            const password = document.getElementById('password').value;

            if (!identifier || !password) return;

            try {
                const data = await apiRequest('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ identifier, password })
                });

                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('currentUser', JSON.stringify(data.user));

                window.location.href = 'dashboard.html';
            } catch (err) {
                console.error(err);
                alert(err.message || 'Login failed. Please check your credentials.');
            }
        });
    }

    // Signup Handler (uses backend)
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('reg-identifier')?.value.trim();
            const password = document.getElementById('reg-password')?.value;
            const fullName = document.getElementById('fullname')?.value;
            const username = document.getElementById('username')?.value;
            const daySelect = document.getElementById('dob-day');
            const monthSelect = document.getElementById('dob-month');
            const yearSelect = document.getElementById('dob-year');

            if (!identifier || !password || !username) {
                alert('Please fill in identifier, password and username.');
                return;
            }

            let dob = null;
            if (daySelect && monthSelect && yearSelect &&
                daySelect.value && monthSelect.value && yearSelect.value) {
                const yyyy = yearSelect.value;
                const mm = monthSelect.value.toString().padStart(2, '0');
                const dd = daySelect.value.toString().padStart(2, '0');
                dob = `${yyyy}-${mm}-${dd}`;
            }

            try {
                const data = await apiRequest('/auth/signup', {
                    method: 'POST',
                    body: JSON.stringify({
                        identifier,
                        password,
                        full_name: fullName || null,
                        username,
                        dob
                    })
                });

                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('currentUser', JSON.stringify(data.user));

                alert('Account created successfully!');
                window.location.href = 'dashboard.html';
            } catch (err) {
                console.error(err);
                alert(err.message || 'Signup failed. Please try again.');
            }
        });
    }

    // Load User Data (Dashboard & Settings)
    loadUserData();

    // Populate Days dynamically for better UX (Optional enhancement)
    const daySelect = document.getElementById('dob-day');
    if (daySelect && daySelect.options.length <= 1) { // Only if not manually populated
        for (let i = 1; i <= 31; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            daySelect.appendChild(option);
        }
    }

    // Populate Years dynamically
    const yearSelect = document.getElementById('dob-year');
    if (yearSelect && yearSelect.options.length <= 1) {
        const currentYear = new Date().getFullYear();
        for (let i = currentYear; i >= 1920; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
    }

    // Initialise medications list when needed
    if (document.getElementById('medicationList')) {
        renderMedications();
    }

    // Caregivers page: load caregivers and wire "Add Caregiver" button
    if (document.getElementById('contactList')) {
        renderCaregivers();

        const addCaregiverBtn = document.querySelector('.caregivers-container .btn-add-med');
        if (addCaregiverBtn) {
            addCaregiverBtn.addEventListener('click', async () => {
                if (!getAccessToken()) {
                    alert('Please log in before managing caregivers.');
                    window.location.href = 'index.html';
                    return;
                }

                const name = prompt('Caregiver name:');
                if (!name) return;

                const relation = prompt('Relation (e.g., Daughter, Doctor):') || '';
                const phone = prompt('Phone number (optional):') || '';
                const email = prompt('Email (optional):') || '';

                try {
                    const newCg = await apiRequest('/caregivers', {
                        method: 'POST',
                        body: JSON.stringify({
                            name,
                            relation: relation || null,
                            phone: phone || null,
                            email: email || null,
                            is_primary: false
                        })
                    });

                    appendCaregiverCard(newCg, document.getElementById('contactList'));
                    alert('Caregiver added successfully!');
                } catch (err) {
                    console.error(err);
                    alert(err.message || 'Failed to add caregiver. Please try again.');
                }
            });
        }
    }
});

