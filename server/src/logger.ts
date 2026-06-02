import winston from "winston";
import { appConfig } from "./config.js";

export const logger = winston.createLogger({
  level: appConfig.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "claude-remote-server" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length > 1
            ? " " + JSON.stringify(rest)
            : "";
          return `${timestamp} ${level}: ${message}${extra}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: "server.log",
      dirname: appConfig.projectDir,
      maxsize: 10_485_760, // 10 MB
      maxFiles: 5,
    }),
  ],
});
