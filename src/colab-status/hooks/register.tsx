import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ColabChain } from '../types'

// 走っている Colab の鎖を読む係（Python）。自分のプロセスの /proc と、鎖の OUT の下のログを読むだけで、
// colab CLI は呼ばない（課金・認証に触らない）。どこに置いても動くよう、MOD の中に埋め込んで python3 -c で走らせる。
export const STATE_PY = String.raw`"""走っている Colab の鎖（run-h3-image・run-h3-video・run-minimax-music）の状態を JSON で出す。/proc と OUT の下のログを読むだけ。colab CLI は呼ばない。"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta

# 鎖のファイル名 → 種類と、同じ scripts/ フォルダにある進捗スクリプトの名前。
# スキルをどこに置いても動くよう、進捗スクリプトの場所は、動いている鎖のファイルの場所から決める（決め打ちのフォルダを持たない）
KINDS = [
    (re.compile(r"/run-h3-image/scripts/chain_h3image[^/\s]*\.sh$"), "image", "h3image_progress.py"),
    (re.compile(r"/run-h3-video/scripts/chain_(h3_all|h3_ref2va|ctxloop)\.sh$"), "video", "progress_bar.py"),
    (re.compile(r"/run-minimax-music/scripts/chain_music[^/\s]*\.sh$"), "music", "progress_bar.py"),
]
# A100 80GB high-mem の実消費（run-h3-image の SKILL.md・ナレッジ unit-prices.md と同じ値）
CU_PER_HOUR_A100 = 6.55
YEN_PER_CU = 11.79
# 新しく VM を立てた時は「new rc=0」、立っている VM を使い回す時（連続焼き）は「既存セッション … を再利用」が出る
VM_UP = re.compile(r"^(\d\d:\d\d:\d\d) \[chain\] (?:new rc=0|.*既存セッション \S+ を再利用)", re.M)


def chains():
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                args = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
        except OSError:
            continue
        if len(args) < 2 or os.path.basename(args[0]) != "bash":
            continue
        script = args[1]
        if not os.path.isabs(script):
            try:
                script = os.path.join(os.readlink(f"/proc/{pid}/cwd"), script)
            except OSError:
                pass
        for pat, kind, bar in KINDS:
            if pat.search(script):
                yield int(pid), kind, os.path.join(os.path.dirname(script), bar)
                break


def env_of(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            pairs = [p.decode(errors="replace").split("=", 1) for p in f.read().split(b"\0") if b"=" in p]
        return dict(pairs)
    except OSError:
        return {}


def vm_sec(out):
    try:
        path = os.path.join(out, "chain.log")
        with open(path, encoding="utf-8", errors="replace") as f:
            m = VM_UP.search(f.read())
        if not m:
            return None
        day = datetime.fromtimestamp(os.path.getmtime(path)).date()
        up = datetime.combine(day, datetime.strptime(m.group(1), "%H:%M:%S").time())
        if up > datetime.now():
            up -= timedelta(days=1)
        return max(0, int((datetime.now() - up).total_seconds()))
    except OSError:
        return None


def main():
    found = []
    seen = set()
    # 鎖は中でサブシェルを作り、どれも同じ cmdline になる。1 本の鎖が何行にも出ないよう、OUT ごとに 1 つだけ数える
    for pid, kind, bar in sorted(chains()):
        env = env_of(pid)
        out = env.get("OUT", "")
        if not out or out.rstrip("/") in seen:
            continue
        seen.add(out.rstrip("/"))
        job = env.get("JOB", "")
        name = os.path.splitext(os.path.basename(job))[0] if job else os.path.basename(out.rstrip("/"))
        if job and name == "job":  # jobs/<名前>/job.json の形では、フォルダ名がジョブの名前
            name = os.path.basename(os.path.dirname(job))
        line = ""
        try:
            r = subprocess.run([sys.executable, "-I", bar, out, "--pid", str(pid), "--once"],
                               capture_output=True, text=True, timeout=8)
            lines = [x for x in r.stdout.splitlines() if x.strip()]
            line = lines[-1].strip() if lines else ""
        except (OSError, subprocess.TimeoutExpired):
            pass
        sec = vm_sec(out)
        gpu = env.get("GPU", "A100")
        yen = round(sec / 3600 * CU_PER_HOUR_A100 * YEN_PER_CU, 1) if sec is not None and gpu == "A100" else None
        found.append({"kind": kind, "name": name, "line": line, "vm_sec": sec, "yen": yen})
    json.dump(found, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
`
export const POLL_MS = 10_000

const chains = atom({ plugin: 'colab-status', key: 'chains' } as const, [] as readonly ColabChain[])

const KIND_LABEL: Record<ColabChain['kind'], string> = { image: '画像', video: '動画', music: '音楽' }

function isChain(one: unknown): one is ColabChain {
  if (one === null || typeof one !== 'object') return false
  const c = one as Record<string, unknown>
  return (c.kind === 'image' || c.kind === 'video' || c.kind === 'music')
    && typeof c.name === 'string' && typeof c.line === 'string'
    && (c.vm_sec === null || typeof c.vm_sec === 'number')
    && (c.yen === null || typeof c.yen === 'number')
}

export function parseChains(stdout: string): ColabChain[] {
  try {
    const parsed = JSON.parse(stdout) as unknown
    return Array.isArray(parsed) ? parsed.filter(isChain) : []
  } catch {
    return []
  }
}

/** 進捗の 1 行から「経過 N分」を外す（その数字は進捗スクリプトを呼んだ瞬間からの時間で、VM の時間ではない）。 */
export function trimLine(line: string): string {
  return line.replace(/\s*経過\s*\d+分\s*$/, '').trim()
}

export function vmText(c: ColabChain): string {
  if (c.vm_sec === null) return 'VM 待ち（まだ課金なし）'
  const m = Math.floor(c.vm_sec / 60)
  const yen = c.yen === null ? '' : `・約 ${Math.round(c.yen)} 円`
  return `VM ${m}分${yen}`
}

async function refresh($: EngineInterface) {
  let found: ColabChain[] = []
  try {
    const r = await $.process.run(['/usr/bin/env', 'python3', '-I', '-c', STATE_PY], { timeoutMs: 9_000 })
    if (r.exitCode === 0) found = parseChains(r.stdout)
  } catch {
    found = []
  }
  const before = await read($, chains)
  if (JSON.stringify(before) !== JSON.stringify(found)) await update($, chains, () => found)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))
    return next(e)
  })

  // 入力欄の右下（ステータス行の右端＝SessionMode）に、鎖 1 本につき 2 行足す。
  // 下の層（本体のモードの印・ほかの mod の行）は、自分の行の上にそのまま残す。鎖が無ければ何も描かない。
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const original = await next(e)
    const live = await read($, chains)
    if (live.length === 0) return original

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" alignItems="flex-end">
        {original}
        {live.map(c => (
          <Box flexDirection="column" alignItems="flex-end">
            <Text color="warning" wrap="truncate">☁ Colab {KIND_LABEL[c.kind]} {c.name}　{vmText(c)}</Text>
            {c.line === '' ? null : <Text dimColor wrap="truncate">{trimLine(c.line)}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
