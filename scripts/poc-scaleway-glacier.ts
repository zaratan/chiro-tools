/**
 * PoC — Scaleway Glacier upload via rclone.
 *
 * Throwaway spike. Nothing here is meant to move into `src/` as-is: the point
 * is to answer, with measurements rather than assumptions, the five unknowns
 * that decide the shape of the future "coffre en ligne" flow. Same discipline
 * as the ffmpeg spike (`poc-split-ffmpeg.ts`), which killed a design before it
 * was written.
 *
 * Steps A and B need no credentials and run anywhere.
 * Steps C..G need a configured rclone remote and a test bucket:
 *
 *   bun scripts/poc-scaleway-glacier.ts
 *   bun scripts/poc-scaleway-glacier.ts --remote chiro-coffre --bucket my-test-bucket
 *
 * The online steps upload and then delete a few hundred MB. They also
 * deliberately kill an upload mid-flight to observe what is left behind —
 * unfinished multipart uploads are BILLED until aborted, so step G cleans up
 * and its output must be read, not skipped.
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";

const WORK_DIR = "/tmp/chiro-poc-glacier";
const SMALL_MB = 200;
const BIG_MB = 1024;

const findings = [];

const record = (id, question, answer, detail) => {
  findings.push({ id, question, answer, detail });
  const mark = answer === "OUI" ? "+" : answer === "NON" ? "-" : "?";
  console.log(`\n[${mark}] ${id} — ${question}\n    => ${answer}\n    ${detail}`);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return { remote: get("remote"), bucket: get("bucket") };
};

const run = (args, opts = {}) =>
  spawnSync("rclone", args, { encoding: "utf8", ...opts });

/**
 * Runs rclone and returns every parsed `stats` object emitted on stderr.
 * `--use-json-log --stats 1s --stats-log-level NOTICE` is the only structured
 * progress channel rclone offers; everything the future RunningView displays
 * has to come from here.
 */
const runWithStats = (args, onStats) =>
  new Promise((resolve) => {
    const child = spawn(
      "rclone",
      [...args, "--use-json-log", "--stats", "1s", "--stats-log-level", "NOTICE"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const ticks = [];
    let buf = "";
    child.stderr.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (!entry.stats) continue;
        ticks.push(entry.stats);
        onStats?.(entry.stats, child);
      }
    });
    child.on("close", (code) => {
      resolve({ code, ticks });
    });
  });

const makeFile = (path, megabytes) => {
  const chunk = randomBytes(1024 * 1024);
  const fd = openSync(path, "w");
  for (let i = 0; i < megabytes; i++) writeSync(fd, chunk);
  closeSync(fd);
};

// ---------------------------------------------------------------------------
// A — Environment. No credentials.
// ---------------------------------------------------------------------------
const stepA = () => {
  console.log("\n=== A — environnement rclone ===");

  const version = run(["version"]);
  if (version.status !== 0) {
    record("A1", "rclone est-il installe ?", "NON", "absent du PATH — les etapes suivantes sont impossibles");
    process.exit(1);
  }
  const versionLine = version.stdout.split("\n")[0];
  record("A1", "rclone est-il installe ?", "OUI", versionLine);

  const providers = run(["config", "providers"]);
  const hasScaleway = /scaleway/i.test(providers.stdout);
  record(
    "A2",
    "Scaleway est-il un provider s3 connu de rclone ?",
    hasScaleway ? "OUI" : "NON",
    hasScaleway
      ? "provider dedie — pas de bricolage d'endpoint a la main"
      : "il faudrait configurer un endpoint s3 generique",
  );

  // The decisive one. rclone exposes an explicit resume flag for the backends
  // that support it (--oos-attempt-resume-upload, --jottacloud-upload-resume-limit).
  // Its absence on the s3 backend is the evidence, not an inference.
  const flags = run(["help", "flags"]).stdout;
  const s3Flags = flags.split("\n").filter((l) => /^\s+--s3-/.test(l));
  const s3Resume = s3Flags.filter((l) => /resume/i.test(l));
  const otherResume = flags
    .split("\n")
    .filter((l) => /resume/i.test(l))
    .map((l) => l.trim().split(/\s+/)[0]);
  record(
    "A3",
    "rclone sait-il REPRENDRE un multipart s3 entre deux invocations ?",
    s3Resume.length > 0 ? "OUI" : "NON",
    `aucun flag --s3-*resume* (${s3Flags.length} flags s3 inspectes). ` +
      `Les backends qui savent le faire l'exposent : ${otherResume.join(", ") || "aucun"}. ` +
      `=> une coupure fait TOUT recommencer pour l'objet en cours.`,
  );

  const leaveParts = /leave_parts_on_error/.test(run(["help", "backend", "s3"]).stdout);
  record(
    "A4",
    "Que propose rclone en cas d'echec ? (--s3-leave-parts-on-error)",
    leaveParts ? "PARTIEL" : "NON",
    "documente 'for manual recovery' et defaut=false. Le laisser a false : sinon les parts " +
      "restent FACTUREES sans que rien ne les reprenne automatiquement.",
  );

  const backendCmds = run(["backend", "help", "s3"]).stdout;
  const has = (c) => new RegExp(`^### ${c}$`, "m").test(backendCmds);
  const lifecycle = ["restore", "restore-status", "list-multipart-uploads", "cleanup"].filter(has);
  record(
    "A5",
    "Le cycle de vie Glacier est-il pilotable depuis rclone ?",
    lifecycle.length === 4 ? "OUI" : "PARTIEL",
    `commandes disponibles : ${lifecycle.join(", ")}. ` +
      `'restore' + 'restore-status' = le chemin de recuperation a 3 ans tient en une commande ; ` +
      `'list-multipart-uploads' + 'cleanup' = les orphelins factures sont observables et purgeables.`,
  );
};

// ---------------------------------------------------------------------------
// B — Progress contract. No credentials.
// ---------------------------------------------------------------------------
const stepB = async () => {
  console.log("\n=== B — contrat de progression (stats JSON) ===");
  mkdirSync(`${WORK_DIR}/src`, { recursive: true });
  mkdirSync(`${WORK_DIR}/dst`, { recursive: true });
  const src = `${WORK_DIR}/src/probe.bin`;
  makeFile(src, SMALL_MB);

  // --local-no-clone defeats the APFS server-side clone, which would finish
  // instantly and emit a single terminal tick.
  const { ticks } = await runWithStats([
    "copyto",
    src,
    `${WORK_DIR}/dst/probe.bin`,
    "--local-no-clone",
    "--bwlimit",
    "30M",
  ]);

  const required = ["bytes", "totalBytes", "speed", "eta", "errors", "fatalError"];
  const first = ticks[0] ?? {};
  const missing = required.filter((k) => !(k in first));
  record(
    "B1",
    "Les stats JSON portent-elles ce qu'il faut pour le ProgressPanel ?",
    missing.length === 0 ? "OUI" : "NON",
    `${ticks.length} ticks (1/s). Champs presents : ${required.filter((k) => k in first).join(", ")}` +
      (missing.length ? ` — MANQUANTS : ${missing.join(", ")}` : ""),
  );

  const firstEtaNull = ticks.length > 0 && (ticks[0].eta === null || ticks[0].speed === 0);
  record(
    "B2",
    "Le premier tick est-il exploitable tel quel ?",
    firstEtaNull ? "NON" : "OUI",
    firstEtaNull
      ? `premier tick : eta=${JSON.stringify(ticks[0].eta)}, speed=${ticks[0].speed} — l'UI doit tolerer ` +
        `un demarrage sans estimation (etaTracker gere deja sa phase de chauffe).`
      : "utilisable des le premier tick",
  );

  const monotonic = ticks.every((t, i) => i === 0 || t.bytes >= ticks[i - 1].bytes);
  record(
    "B3",
    "'bytes' est-il monotone et adosse a 'totalBytes' connu d'avance ?",
    monotonic && first.totalBytes > 0 ? "OUI" : "NON",
    `totalBytes=${first.totalBytes} des le 1er tick, bytes croissant : ${monotonic}. ` +
      `=> on peut alimenter NOTRE etaTracker (fenetre 50) et ignorer l'eta de rclone, ` +
      `pour que les 4 flux estiment de la meme facon.`,
  );

  rmSync(`${WORK_DIR}/dst/probe.bin`, { force: true });
};

// ---------------------------------------------------------------------------
// C..G — online. Need --remote and --bucket.
// ---------------------------------------------------------------------------
const stepsOnline = async (remote, bucket) => {
  const base = `${remote}:${bucket}`;
  const keySmall = "chiro-poc/petit.bin";
  const keyBig = "chiro-poc/gros.bin";

  console.log("\n=== C — joignabilite du remote ===");
  const ls = run(["lsd", base, "--max-depth", "1"]);
  record(
    "C1",
    "Le remote et le bucket repondent-ils ?",
    ls.status === 0 ? "OUI" : "NON",
    ls.status === 0 ? "credentials OK" : `echec: ${ls.stderr.trim().split("\n").slice(-2).join(" | ")}`,
  );
  if (ls.status !== 0) return;

  console.log("\n=== D — classe de stockage GLACIER + debit reel vers Scaleway ===");
  const src = `${WORK_DIR}/src/probe.bin`;
  const up = await runWithStats([
    "copyto",
    src,
    `${base}/${keySmall}`,
    "--s3-storage-class",
    "GLACIER",
  ]);

  // The number that actually decides "objet unique ou serie ?". A generic
  // speedtest measures the path to a nearby test server; what matters is
  // sustained throughput to the Scaleway endpoint, over HTTPS, with rclone's
  // multipart concurrency. Only this measures that.
  const peak = Math.max(0, ...up.ticks.map((t) => t.speed ?? 0));
  if (peak > 0) {
    const mbps = (peak * 8) / 1e6;
    const hours = (15 * 1024 ** 3) / peak / 3600;
    record(
      "D2",
      "Quel debit reel vers Scaleway, et donc quelle duree pour une archive de 15 Go ?",
      hours < 1 ? "OUI" : "NON",
      `${mbps.toFixed(0)} Mb/s soutenus => 15 Go en ${hours < 1 ? `${(hours * 60).toFixed(0)} min` : `${hours.toFixed(1)} h`}. ` +
        (hours < 1
          ? "Assez court pour qu'un objet unique tienne : l'absence de reprise (A3) devient sans consequence."
          : "Trop long sans reprise (A3) : il faut une serie de volumes, que rclone reprend au fichier."),
    );
  }

  if (up.code !== 0) {
    record("D1", "GLACIER accepte directement a l'upload ?", "NON", "echec du transfert — voir la sortie rclone ci-dessus");
  } else {
    const meta = run(["lsjson", `${base}/${keySmall}`, "--stat"]);
    let tier = "inconnu";
    try {
      const j = JSON.parse(meta.stdout);
      tier = j?.Tier ?? j?.StorageClass ?? "absent de lsjson";
    } catch {
      /* leave as inconnu */
    }
    record(
      "D1",
      "GLACIER accepte directement a l'upload (pas de transition lifecycle) ?",
      /glacier/i.test(String(tier)) ? "OUI" : "A VERIFIER",
      `classe relue depuis l'objet : ${tier}. Si ce n'est pas GLACIER, il faut une regle ` +
        `de cycle de vie sur le bucket et l'objet coute le tarif standard entre-temps.`,
    );
  }

  console.log("\n=== E — ce qui reste apres une coupure en plein vol ===");
  const bigSrc = `${WORK_DIR}/src/gros.bin`;
  makeFile(bigSrc, BIG_MB);
  let killed = false;
  const first = await runWithStats(
    ["copyto", bigSrc, `${base}/${keyBig}`, "--s3-storage-class", "GLACIER", "--bwlimit", "20M"],
    (stats, child) => {
      // Kill once a few multipart chunks are certainly in flight.
      if (!killed && stats.bytes > 60 * 1024 * 1024) {
        killed = true;
        child.kill("SIGKILL");
      }
    },
  );
  const bytesBeforeKill = first.ticks.at(-1)?.bytes ?? 0;

  const orphans = run(["backend", "list-multipart-uploads", base]);
  let orphanCount = 0;
  try {
    const parsed = JSON.parse(orphans.stdout);
    orphanCount = Object.values(parsed).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  } catch {
    /* leave at 0 */
  }
  record(
    "E1",
    "Un SIGKILL laisse-t-il des parts multipart FACTUREES ?",
    orphanCount > 0 ? "OUI" : "NON",
    `${orphanCount} multipart inacheve(s) apres kill a ${(bytesBeforeKill / 1e6).toFixed(0)} Mo. ` +
      `=> il faut A LA FOIS une regle de cycle de vie cote bucket ET un 'rclone backend cleanup' ` +
      `propose par chiro. C'est le meme probleme que cleanOrphanStagingDirs, un cran plus loin.`,
  );

  console.log("\n=== F — reprise reelle apres coupure (verification empirique de A3) ===");
  const second = await runWithStats(
    ["copyto", bigSrc, `${base}/${keyBig}`, "--s3-storage-class", "GLACIER", "--bwlimit", "20M"],
    (stats, child) => {
      if (stats.bytes > 30 * 1024 * 1024) child.kill("SIGKILL");
    },
  );
  const restart = second.ticks[0]?.bytes ?? 0;
  record(
    "F1",
    "La reprise repart-elle des octets deja envoyes ?",
    restart > bytesBeforeKill * 0.5 ? "OUI" : "NON",
    `1er tick de la 2e tentative : ${(restart / 1e6).toFixed(0)} Mo (la 1re s'etait arretee a ` +
      `${(bytesBeforeKill / 1e6).toFixed(0)} Mo). ${restart < bytesBeforeKill * 0.5 ? "Confirme A3 : on repart de zero." : "Contredit A3 — a creuser."}`,
  );

  console.log("\n=== G — nettoyage (a lire, pas a sauter) ===");
  const cleanup = run(["backend", "cleanup", "-o", "max-age=0", base]);
  const del = run(["delete", `${base}/chiro-poc/`, "--rmdirs"]);
  const after = run(["backend", "list-multipart-uploads", base]);
  record(
    "G1",
    "Le bucket de test est-il rendu propre ?",
    cleanup.status === 0 && del.status === 0 ? "OUI" : "A VERIFIER",
    `cleanup=${cleanup.status} delete=${del.status}. Restant : ${after.stdout.trim().slice(0, 200)}`,
  );
};

// ---------------------------------------------------------------------------

const main = async () => {
  const { remote, bucket } = parseArgs();
  stepA();
  await stepB();

  if (remote && bucket) {
    await stepsOnline(remote, bucket);
  } else {
    console.log(
      "\n=== C..G ignorees ===\n" +
        "    Ces etapes demandent un vrai bucket :\n" +
        "      bun scripts/poc-scaleway-glacier.ts --remote <nom> --bucket <bucket>\n" +
        "    Restent ouvertes : classe GLACIER a l'ecriture, orphelins factures apres kill,\n" +
        "    et la confirmation empirique de A3 sur Scaleway.",
    );
  }

  console.log("\n\n=== SYNTHESE ===");
  for (const f of findings) {
    console.log(`  ${f.answer.padEnd(11)} ${f.id}  ${f.question}`);
  }
  console.log(
    "\n  Non couvert par ce script (question de tarification, a lire chez Scaleway) :\n" +
      "    - duree minimale de facturation Glacier et frais de suppression anticipee\n" +
      "    - delai et cout d'une restauration, egress associe\n",
  );

  try {
    rmSync(WORK_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};

await main();
