const backgroundExecLogger = {
  error: (...params: unknown[]) => console.error(...params),
  warn: (...params: unknown[]) => console.warn(...params),
  info: (...params: unknown[]) => console.info(...params)
}

export default backgroundExecLogger
