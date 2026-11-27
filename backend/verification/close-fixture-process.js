import { once } from 'node:events';

export async function closeFixtureProcess(child, name) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  const deadline = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      console.log(name + ' fixture process required forced shutdown');
      child.kill('SIGKILL');
    }
  }, 2000);
  try {
    child.kill();
    await closed;
  } finally {
    clearTimeout(deadline);
  }
}
