// Sign-in (Google or email/password), registration and account-state screens.
import {
  auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut, authError
} from "../fb.js";
import { $, esc, toast, busy, fmtDate, officeSelect } from "../ui.js";
import { register, claimSuperadmin, isBootstrapEmail } from "../data.js";
import { settings } from "../state.js";

const G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const hero = () => `<section class="auth-hero">
    <img class="seal" src="assets/municipal-seal.png" alt="Seal of the Municipality of Candoni">
    <h1>Property and Inventory Management</h1>
    <p class="sub">Acceptance and Inspection Reports, property and supplies issuance (PAR, ICS, RIS) and Accounting posting for the Municipal Government of Candoni, Negros Occidental.</p>
    <div class="pillars"><span>ACCOUNTABILITY.</span><span>TRANSPARENCY.</span><span>SERVICE.</span></div>
  </section>`;

export function renderSetupNeeded(root) {
  root.innerHTML = `<div class="center-screen"><div class="card setup"><h2>Firebase is not connected yet</h2>
    <p>Open <code>public/js/firebase-config.js</code> and paste your Firebase project's web app config, then redeploy. The README walks through it step by step.</p></div></div>`;
}

export function renderLogin(root, mode = "signin") {
  const create = mode === "create";
  root.innerHTML = `<div class="auth">${hero()}
    <section class="auth-panel"><div class="auth-box">
      <h2>${create ? "Create your account" : "Sign in"}</h2>
      <p class="muted small" style="margin-top:0">${create ? "After creating your account, fill in your office details. An administrator approves your access." : "End-users, GSO, Accounting and administrators all sign in here."}</p>
      <button class="gbtn" id="g">${G} Continue with Google</button>
      <div class="or">or use your email</div>
      <form id="f" class="grid" novalidate>
        <div><label for="em">Email address</label><input type="email" id="em" autocomplete="email" required></div>
        <div><label for="pw">Password</label><input type="password" id="pw" autocomplete="${create ? "new-password" : "current-password"}" required minlength="8"></div>
        ${create ? `<div><label for="pw2">Confirm password</label><input type="password" id="pw2" autocomplete="new-password" required></div><p class="xs muted" style="margin:0">At least 8 characters.</p>` : ""}
        <button class="btn primary block" type="submit">${create ? "Create account" : "Sign in"}</button>
      </form>
      <div class="form-msg err" id="msg" role="alert"></div>
      <div class="auth-links">${create
        ? `<button class="link" id="to-in">I already have an account</button>`
        : `<button class="link" id="to-create">Create an account</button><button class="link" id="forgot">Forgot password?</button>`}</div>
      <p class="xs muted" style="margin-top:2rem">For official use of the Municipal Government of Candoni. Personal information is processed under the Data Privacy Act of 2012 (RA 10173).</p>
    </div></section></div>`;
  const msg = (t, ok) => { const m = $("#msg"); m.textContent = t; m.className = "form-msg " + (ok ? "ok" : "err"); };
  $("#g").onclick = async () => {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    try { await signInWithPopup(auth, p); }
    catch (e) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) await signInWithRedirect(auth, p).catch(x => msg(authError(x)));
      else if (e.code !== "auth/popup-closed-by-user") msg(authError(e));
    }
  };
  $("#f").onsubmit = async ev => {
    ev.preventDefault();
    const em = $("#em").value.trim(), pw = $("#pw").value;
    if (!em) return msg("Enter your email address.");
    if (!pw) return msg("Enter your password.");
    try {
      if (create) {
        if (pw.length < 8) return msg("Use a password of at least 8 characters.");
        if (pw !== $("#pw2").value) return msg("The passwords do not match.");
        const c = await createUserWithEmailAndPassword(auth, em, pw);
        sendEmailVerification(c.user).catch(() => {});
      } else await signInWithEmailAndPassword(auth, em, pw);
    } catch (e) { msg(authError(e)); }
  };
  if (create) $("#to-in").onclick = () => renderLogin(root, "signin");
  else {
    $("#to-create").onclick = () => renderLogin(root, "create");
    $("#forgot").onclick = async () => {
      const em = $("#em").value.trim() || (prompt("Email address of your account:") || "").trim();
      if (!em) return;
      try { await sendPasswordResetEmail(auth, em); msg(`If an account exists for ${em}, a reset link has been sent. Check Spam too.`, true); }
      catch (e) { msg(authError(e)); }
    };
  }
}

/** No account record yet, or pending / declined / disabled. */
export function renderAccountState(root, acc) {
  const u = auth.currentUser;
  if (!acc) return renderRegister(root, null);
  let title, body = "";
  if (acc.status === "pending") {
    title = "Waiting for approval";
    body = `<p>Your registration was received on ${fmtDate(acc.createdAt)}. An administrator will confirm your office and assign your role (End-User, GSO or Accounting). This page updates on its own.</p>
      ${u.providerData?.[0]?.providerId === "password" && !u.emailVerified ? `<div class="notice warn">Please confirm your email address using the link sent to <b>${esc(u.email)}</b>. <button class="link" id="resend">Send again</button></div>` : ""}
      <button class="btn" id="edit">Edit my registration</button>`;
  } else if (acc.status === "declined") {
    title = "Registration not approved";
    body = `${acc.note ? `<div class="notice bad">${esc(acc.note)}</div>` : ""}<p>If you think this is a mistake, contact the system administrator.</p>`;
  } else {
    title = "Account disabled";
    body = `<p>This account can no longer use the system. Contact the system administrator.</p>`;
  }
  root.innerHTML = `<div class="center-screen"><div class="card" style="max-width:520px;width:100%">
    <div style="text-align:center"><img src="assets/municipal-seal.png" alt="" width="64" height="64"><h2>${title}</h2><p class="muted small">${esc(u.email)}</p></div>
    ${body}<div style="margin-top:1.2rem"><button class="btn block" id="out">Sign out</button></div></div></div>`;
  $("#out").onclick = () => signOut(auth);
  $("#edit") && ($("#edit").onclick = () => renderRegister(root, acc));
  $("#resend") && ($("#resend").onclick = () => sendEmailVerification(u).then(() => toast("Verification email sent.", "ok")));
}

function renderRegister(root, acc) {
  const u = auth.currentUser;
  const boot = isBootstrapEmail(u.email);
  const offices = settings().offices;
  root.innerHTML = `<div class="center-screen"><div class="card auth-box wide">
    <div class="card-head"><div><h2>${acc ? "Update your registration" : "Complete your registration"}</h2><p class="muted small" style="margin:0">Signed in as <b>${esc(u.email)}</b></p></div><img src="assets/municipal-seal.png" alt="" width="54" height="54"></div>
    ${boot && !acc ? `<div class="notice info">This email is the system's designated <b>Super Administrator</b>. ${u.emailVerified ? "Fill in your details and claim access." : "Verify your email address first (check your inbox), then reload this page."}</div>` : ""}
    <form id="rf" class="grid g2" novalidate>
      <div class="spanall"><label class="req">Full name</label><input type="text" name="displayName" value="${esc(acc?.displayName || u.displayName || "")}" required placeholder="e.g. Juan A. Dela Cruz"></div>
      <div><label class="req">Office / Department</label>${officeSelect("office", acc?.office || "", offices, { required: true, blank: "Choose your office" })}</div>
      <div><label class="req">Position / Designation</label><input type="text" name="position" value="${esc(acc?.position || "")}" required></div>
      <div><label>Contact number</label><input type="tel" name="contact" value="${esc(acc?.contact || "")}"></div>
      <div class="spanall form-msg err" id="rmsg" role="alert"></div>
      <div class="spanall btn-row" style="justify-content:space-between"><button type="button" class="btn" id="cancel">${acc ? "Cancel" : "Sign out"}</button>
        <button class="btn primary" type="submit">${boot && !acc ? "Claim Super Administrator access" : "Submit for approval"}</button></div>
    </form></div></div>`;
  const form = $("#rf");
  form.addEventListener("input", () => { form.dataset.touched = "1"; });
  $("#cancel").onclick = () => acc ? renderAccountState(root, acc) : signOut(auth);
  form.onsubmit = ev => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.displayName?.trim() || !data.office?.trim() || !data.position?.trim()) { $("#rmsg").textContent = "Fill in your name, office and position."; return; }
    busy(form.querySelector("[type=submit]"), async () => {
      try {
        if (boot && !acc) {
          if (!u.emailVerified) throw new Error("Verify your email address first, then reload this page.");
          await claimSuperadmin(data);
        } else await register(data);
        toast(boot && !acc ? "Super Administrator access granted." : "Registration submitted.", "ok");
      } catch (e) { $("#rmsg").textContent = e.message; throw e; }
    }).catch(() => {});
  };
}
