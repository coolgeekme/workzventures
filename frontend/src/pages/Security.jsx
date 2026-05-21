import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  ShieldCheck, Lock, Cube, ArrowsClockwise, Download,
  CheckCircle, Clock, ArrowSquareOut, Link as LinkIcon, FileText, X,
} from "@phosphor-icons/react";

const KIND_LABEL = {
  "nda.signature": "NDA signature",
  "vault.file": "Vault file",
  "vault.findings": "AI findings",
  "inquiry.status": "Inquiry status",
  "audit_chain_checkpoint": "Audit checkpoint",
};

export default function Security() {
  const { user } = useAuth();
  const [posture, setPosture] = useState(null);
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [chainStatus, setChainStatus] = useState(null);
  const [verifyOpen, setVerifyOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api.get("/security/posture"),
        api.get("/security/proofs"),
      ]);
      setPosture(a.data);
      setProofs(b.data);
    } catch (e) {
      toast.error("Failed to load security data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const upgrade = async (id) => {
    setBusyId(id);
    try {
      const r = await api.post(`/security/proofs/${id}/upgrade`);
      if (r.data.btc_block_height) {
        toast.success(`Bitcoin-confirmed at block ${r.data.btc_block_height.toLocaleString()}`);
      } else if (r.data.upgraded) {
        toast.success("Proof upgraded — still waiting for Bitcoin confirmation");
      } else {
        toast.message("No new attestation yet — typically takes 1-6 hours after submission");
      }
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upgrade failed");
    } finally {
      setBusyId(null);
    }
  };

  const downloadOts = async (p) => {
    try {
      const r = await api.get(`/security/proofs/${p.id}/download`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/vnd.opentimestamps" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workz-${p.kind}-${(p.digest_hex || "proof").slice(0, 8)}.ots`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  const verifyChain = async () => {
    setBusyId("__chain");
    try {
      const r = await api.get("/security/audit/verify");
      setChainStatus(r.data);
      if (r.data.chain_valid) toast.success(`Chain verified · ${r.data.total_entries} entries`);
      else toast.error(`Chain broken at seq ${r.data.broken_at?.seq}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verify failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 text-sm text-[var(--wz-text-secondary)]">Loading security console…</div>;

  return (
    <div data-testid="security-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3" style={{ color: "var(--wz-gold)" }}>Cryptographic transparency</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">Security console</h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-3xl">
        Every consequential event on this platform is hashed and submitted to the public Bitcoin blockchain
        via the open <a className="text-[var(--wz-gold)] hover:underline" href="https://opentimestamps.org" target="_blank" rel="noreferrer">OpenTimestamps</a> protocol.
        You don't have to trust us — you can verify each `.ots` proof yourself against the public Bitcoin chain.
      </p>

      {/* Posture grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8" data-testid="posture-grid">
        <Tile icon={Cube} title="Bitcoin-anchored" hint="OpenTimestamps via public calendars" pill={`${posture?.ots?.confirmed_proofs || 0} confirmed · ${posture?.ots?.pending_proofs || 0} pending`} on={posture?.features?.opentimestamps} />
        <Tile icon={Lock} title="At-rest encryption" hint={posture?.features?.encryption_alg || "—"} pill={posture?.features?.at_rest_encryption ? "AES-256-GCM" : "off"} on={posture?.features?.at_rest_encryption} />
        <Tile icon={ShieldCheck} title="Tamper-evident audit chain" hint={`head seq ${posture?.audit_chain?.last_seq || 0}`} pill={posture?.audit_chain?.last_hash ? `${posture.audit_chain.last_hash.slice(0,10)}…` : "empty"} on />
        <Tile icon={LinkIcon} title="Auth hardening" hint="Brute-force lockout · HSTS · CSP basics" pill="enabled" on />
      </div>

      {/* Chain verifier (admin only) */}
      {isAdmin && (
        <div className="wz-card p-5 mt-8" data-testid="chain-verifier">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="overline mb-1">Audit chain integrity</div>
              <div className="text-sm text-[var(--wz-text-secondary)]">Re-walk every audit entry, recompute the SHA-256 chain. Any tampering surfaces as a break.</div>
            </div>
            <button
              data-testid="verify-chain-btn"
              onClick={verifyChain}
              disabled={busyId === "__chain"}
              className="wz-btn wz-btn-gold flex items-center gap-2"
            >
              <ArrowsClockwise size={14} /> {busyId === "__chain" ? "Verifying…" : "Verify chain"}
            </button>
          </div>
          {chainStatus && (
            <div className="mt-4 pt-4 border-t border-[var(--wz-border)] grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <KV k="entries" v={chainStatus.total_entries} />
              <KV k="valid" v={chainStatus.chain_valid ? "yes" : "no"} good={chainStatus.chain_valid} />
              <KV k="head seq" v={chainStatus.chain_head?.last_seq || 0} />
              <KV k="verified_at" v={new Date(chainStatus.verified_at).toLocaleString()} mono />
              {chainStatus.broken_at && (
                <div className="col-span-full text-xs text-[var(--wz-negative)]">
                  Break at seq {chainStatus.broken_at.seq}: {chainStatus.broken_at.reason}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Verifier upload (anyone can verify any .ots) */}
      <div className="flex items-center justify-between gap-3 mt-10 mb-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl sm:text-2xl tracking-tight font-medium">Your cryptographic proofs</h2>
          <p className="text-xs text-[var(--wz-text-secondary)] mt-1">Download any `.ots` and verify it with the open <code className="font-mono-wz">ots verify</code> CLI or upload it back here.</p>
        </div>
        <button
          onClick={() => setVerifyOpen(true)}
          data-testid="open-verifier"
          className="wz-btn-ghost wz-btn flex items-center gap-2 text-sm"
        >
          <ShieldCheck size={14} /> Verify a proof
        </button>
      </div>

      <div className="wz-card overflow-hidden" data-testid="proofs-list">
        {proofs.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-[var(--wz-text-tertiary)]">
            No proofs yet. Sign an NDA, upload a Vault file, or generate findings — each creates a Bitcoin-anchored proof.
          </div>
        )}
        <div className="divide-y divide-[var(--wz-border)]">
          {proofs.map((p) => (
            <div key={p.id} className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`proof-${p.id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="pill pill-gold">{KIND_LABEL[p.kind] || p.kind}</span>
                  <span className={`pill ${p.status === "confirmed" ? "pill-positive" : "pill-amber"}`}>
                    {p.status === "confirmed" ? (
                      <><CheckCircle size={10} weight="fill" /> Bitcoin-confirmed</>
                    ) : (
                      <><Clock size={10} /> pending</>
                    )}
                  </span>
                </div>
                <div className="font-medium text-sm mt-1.5 truncate">{p.label || p.kind}</div>
                <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-1 break-all">
                  sha-256 {p.digest_hex?.slice(0, 32)}…
                  {p.btc_block_height && <> · block {p.btc_block_height.toLocaleString()}</>}
                  · {new Date(p.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {p.status === "confirmed" && p.btc_block_height && (
                  <a
                    href={`https://mempool.space/block/${p.btc_block_height}`}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`btc-block-${p.id}`}
                    className="text-xs text-[var(--wz-gold)] hover:underline flex items-center gap-1"
                  >
                    block {p.btc_block_height} <ArrowSquareOut size={10} />
                  </a>
                )}
                {p.status === "pending" && (
                  <button
                    onClick={() => upgrade(p.id)}
                    disabled={busyId === p.id}
                    data-testid={`upgrade-${p.id}`}
                    className="text-xs text-[var(--wz-amber)] hover:underline flex items-center gap-1"
                  >
                    <ArrowsClockwise size={11} /> {busyId === p.id ? "checking…" : "check confirmation"}
                  </button>
                )}
                <button
                  onClick={() => downloadOts(p)}
                  data-testid={`download-ots-${p.id}`}
                  className="text-xs flex items-center gap-1 px-2 py-1 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)] text-[var(--wz-text-secondary)]"
                >
                  <Download size={11} /> .ots
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Self-verify instructions */}
      <div className="mt-10 wz-card p-5" data-testid="verify-instructions">
        <div className="overline mb-3">Verify it yourself</div>
        <p className="text-sm text-[var(--wz-text-secondary)] mb-3 leading-relaxed">
          Don't take our word for it. Once a Bitcoin block confirms a proof (typically within 6 hours of creation),
          anyone can verify it with the open-source command line:
        </p>
        <pre className="font-mono-wz text-xs bg-[var(--wz-surface-hover)] border border-[var(--wz-border)] p-4 overflow-x-auto leading-relaxed">
{`# Install
pip install opentimestamps-client

# Verify a proof against the public Bitcoin blockchain
ots verify workz-vault.file-bf589122.ots --no-bitcoin-node`}
        </pre>
        <p className="text-xs text-[var(--wz-text-tertiary)] mt-3">
          The OTS proof contains the path through Merkle roots into a specific Bitcoin block. Verification
          confirms the original file (whose SHA-256 you hold) existed in its exact form before that block was mined.
        </p>
      </div>

      {/* Verifier modal */}
      {verifyOpen && (
        <VerifierModal onClose={() => setVerifyOpen(false)} />
      )}
    </div>
  );
}

function Tile({ icon: Icon, title, hint, pill, on }) {
  return (
    <div className="wz-card p-5">
      <div className="flex items-center justify-between">
        <Icon size={20} className={on ? "text-[var(--wz-gold)]" : "text-[var(--wz-text-tertiary)]"} weight={on ? "fill" : "regular"} />
        <span className={`pill ${on ? "pill-positive" : "pill-amber"}`}>{on ? "on" : "off"}</span>
      </div>
      <div className="font-display text-lg mt-3 tracking-tight">{title}</div>
      <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{hint}</div>
      <div className="text-[10px] font-mono-wz mt-3 text-[var(--wz-text-tertiary)] truncate">{pill}</div>
    </div>
  );
}

function KV({ k, v, mono, good }) {
  return (
    <div>
      <div className="overline mb-1">{k}</div>
      <div className={`${mono ? "font-mono-wz text-xs" : "text-sm"} ${good === true ? "text-[var(--wz-positive)]" : good === false ? "text-[var(--wz-negative)]" : ""}`}>{String(v)}</div>
    </div>
  );
}

function VerifierModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [digest, setDigest] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!file || !digest) return toast.error("Both .ots file and SHA-256 digest required");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("ots_file", file);
      fd.append("digest_hex", digest.trim().toLowerCase());
      const r = await api.post("/security/verify", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verify failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} data-testid="verifier-modal">
      <div className="wz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-xl tracking-tight">Verify a proof</div>
          <button onClick={onClose} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]" data-testid="verifier-close"><X size={16} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="block mb-3">
            <div className="overline mb-1">.ots proof file</div>
            <input type="file" accept=".ots" required onChange={(e) => setFile(e.target.files?.[0] || null)} className="wz-input text-xs" data-testid="verifier-file" />
          </label>
          <label className="block mb-4">
            <div className="overline mb-1">Expected SHA-256 digest (64 hex chars)</div>
            <input
              type="text"
              required
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
              placeholder="bf5891220a43..."
              className="wz-input font-mono-wz text-xs"
              data-testid="verifier-digest"
            />
          </label>
          <button type="submit" disabled={busy} className="wz-btn wz-btn-gold w-full" data-testid="verifier-submit">
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
        {result && (
          <div className="mt-4 pt-4 border-t border-[var(--wz-border)] space-y-2 text-sm" data-testid="verifier-result">
            <div className="flex items-center gap-2">
              {result.matches_digest ? <CheckCircle size={16} weight="fill" className="text-[var(--wz-positive)]" /> : <FileText size={16} className="text-[var(--wz-negative)]" />}
              <span className={result.matches_digest ? "text-[var(--wz-positive)]" : "text-[var(--wz-negative)]"}>
                {result.matches_digest ? "Digest matches the proof" : "Digest does NOT match the proof"}
              </span>
            </div>
            <div className="text-xs text-[var(--wz-text-secondary)] break-all">
              stamped: {result.stamped_digest_hex}
            </div>
            <div className="text-xs">
              {result.btc_block_height ? (
                <span className="text-[var(--wz-positive)]">Bitcoin block {result.btc_block_height.toLocaleString()}</span>
              ) : (
                <span className="text-[var(--wz-amber)]">Pending Bitcoin confirmation</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
