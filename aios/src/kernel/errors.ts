/** Errors raised by syscalls. Userland sees these thrown into its generator. */

export class KernelError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'KernelError';
  }
}

export class ENOENT extends KernelError {
  constructor(path: string) {
    super(`no such file or directory: ${path}`, 'ENOENT');
  }
}

export class EEXIST extends KernelError {
  constructor(path: string) {
    super(`file exists: ${path}`, 'EEXIST');
  }
}

export class EISDIR extends KernelError {
  constructor(path: string) {
    super(`is a directory: ${path}`, 'EISDIR');
  }
}

export class ENOTDIR extends KernelError {
  constructor(path: string) {
    super(`not a directory: ${path}`, 'ENOTDIR');
  }
}

export class EACCES extends KernelError {
  constructor(path: string) {
    super(`permission denied: ${path}`, 'EACCES');
  }
}

export class ESRCH extends KernelError {
  constructor(pid: number) {
    super(`no such process: ${pid}`, 'ESRCH');
  }
}

export class ENOEXEC extends KernelError {
  constructor(name: string) {
    super(`command not found: ${name}`, 'ENOEXEC');
  }
}

export class ENOSYS extends KernelError {
  constructor(call: string) {
    super(`invalid syscall: ${call}`, 'ENOSYS');
  }
}

/** Raised inside a process when it is killed while blocked. */
export class EKILLED extends KernelError {
  constructor() {
    super('killed', 'EKILLED');
  }
}
