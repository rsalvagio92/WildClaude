/**
 * Docker sandbox backend.
 *
 * Uses `dockerode` (optional dep — install via `npm i dockerode @types/dockerode`).
 * If the package is missing or the daemon is unreachable, createDockerSandbox()
 * throws and the factory falls back to local-scratch.
 *
 * Container lifecycle:
 *   - Image: SANDBOX_DOCKER_IMAGE env (default: 'node:20-slim')
 *   - Bind mount: scratch dir → /workspace
 *   - Network: 'none' by default (no internet); set network: 'bridge' to enable.
 *   - Mem limit: opts.memoryMb or SANDBOX_MEM_LIMIT_MB env (default: 512).
 *   - The container is created in `sleep infinity` mode and exec'd into for each command.
 */

import { Sandbox, SandboxOptions, ExecResult, makeScratchDir } from './index.js';
import { logger } from '../logger.js';

const DEFAULT_IMAGE = process.env.SANDBOX_DOCKER_IMAGE || 'node:20-slim';
const DEFAULT_MEM_MB = parseInt(process.env.SANDBOX_MEM_LIMIT_MB ?? '512', 10);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS ?? '300000', 10);

// dockerode is an optional dependency. Dynamic-import it so the package
// remains lean for users who don't need docker. Types are intentionally any
// to keep the dep optional in tsconfig.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DockerLike = any;

async function loadDockerode(): Promise<DockerLike> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('dockerode' as any)) as { default: DockerLike };
    return mod.default ?? mod;
  } catch (err) {
    throw new Error(
      `dockerode not installed — run \`npm install dockerode @types/dockerode\` to enable docker sandbox. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

export async function createDockerSandbox(id: string, opts: SandboxOptions = {}): Promise<Sandbox> {
  const Docker = await loadDockerode();
  const docker = new Docker();

  // Verify daemon is reachable
  await docker.ping();

  const image = opts.image ?? DEFAULT_IMAGE;
  const hostCwd = makeScratchDir(id);
  const memBytes = (opts.memoryMb ?? DEFAULT_MEM_MB) * 1024 * 1024;
  const network = opts.network ?? 'none';

  // Pull image if missing (idempotent — fast when already cached).
  await ensureImage(docker, image);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const container: any = await docker.createContainer({
    Image: image,
    Cmd: ['sleep', 'infinity'],
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [`${hostCwd}:/workspace`],
      NetworkMode: network,
      Memory: memBytes,
      AutoRemove: true,
    },
    Tty: false,
  });

  await container.start();
  logger.info({ id, kind: 'docker', image, network, hostCwd }, 'Sandbox created');

  return {
    id,
    kind: 'docker',
    hostCwd,
    async exec(cmd, execOpts) {
      const timeoutMs = execOpts?.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const start = Date.now();

      const exec = await container.exec({
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = await exec.start({ Detach: false });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // dockerode multiplexes stdout/stderr in a single stream with framing
      // headers. demuxStream splits them into two writable streams.
      const stdoutCollector = new WritableCollector((s) => { stdout += s; });
      const stderrCollector = new WritableCollector((s) => { stderr += s; });
      docker.modem.demuxStream(stream, stdoutCollector, stderrCollector);

      const timer = setTimeout(() => {
        timedOut = true;
        stream.destroy();
      }, timeoutMs);

      await new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', resolve);
      });
      clearTimeout(timer);

      const inspect = await exec.inspect().catch(() => ({ ExitCode: -1 }));
      return {
        exitCode: inspect.ExitCode ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        timedOut,
      };
    },
    async dispose() {
      try {
        await container.stop({ t: 1 });
      } catch (err) {
        logger.warn({ err, sandboxId: id }, 'docker stop failed');
      }
    },
  };
}

async function ensureImage(docker: DockerLike, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // image missing — pull
  }
  logger.info({ image }, 'Pulling docker image…');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docker.modem.followProgress(stream, (err: any) => (err ? reject(err) : resolve()));
  });
}

/**
 * Minimal Writable-like sink that captures buffer chunks as utf8 strings.
 * Avoids pulling in the stream module just for collection.
 */
class WritableCollector {
  writable = true;
  private cb: (s: string) => void;
  constructor(cb: (s: string) => void) { this.cb = cb; }
  write(chunk: Buffer | string): boolean {
    this.cb(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  }
  end(): void { /* noop */ }
  on(): this { return this; }
  once(): this { return this; }
  emit(): boolean { return true; }
}

/** Best-effort: do we have a working docker daemon? */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const Docker = await loadDockerode();
    const d = new Docker();
    await d.ping();
    return true;
  } catch {
    return false;
  }
}
