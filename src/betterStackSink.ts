import { LogEvent } from './logEvent';
import { Sink } from './sink';

export interface BetterStackSinkOptions {
    token: string;
    ingestionUri?: string;
    suppressErrors: boolean;
    durable?: boolean;
  }


  export class BetterStackSink implements Sink {
        private ingestionAddress: string;
        private token: string;
        private levelSwitch = null;
        private suppressErrors = false;
        private durable = false;
        private levelMapping = {
            0: "none",
            1: "critical",
            3: "error",
            7: "warning",
            15: "info",
            31: "debug",
            63: "trace"
        };

        constructor(options: BetterStackSinkOptions) {
            if (!options) {
                throw new Error(`'options' parameter is required.`);
            }
    
            if (!options.token) {
                throw new Error(`'options.token' parameter is required.`);
            }

            this.token = options.token;
            this.suppressErrors = options.suppressErrors !== false;
    
            if ('ingestionUri' in options && options.ingestionUri && typeof options.ingestionUri === 'string') {
                this.ingestionAddress = options.ingestionUri;
            } else {
                this.ingestionAddress = "https://in.logs.betterstack.com";
            }

            if ('durable' in options && options.durable && typeof localStorage === 'undefined') {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(`'options.durable' parameter was set to true, but 'localStorage' is not available.`);
                }
                this.durable = false;
            } else {
                this.durable = !!options.durable;
            }

            if (this.durable) {
                const requests = {};
                for (let i = 0; i < localStorage.length; ++i) {
                    const storageKey = localStorage.key(i);
                    if (storageKey.indexOf('structured-log-betterstack-sink') !== 0) {
                        continue;
                    }
    
                    const body = localStorage.getItem(storageKey);
                    requests[storageKey] = this.sendRecord(body, () => storageKey)
                        .then((k) => localStorage.removeItem(k as string))
                        .catch(reason => this.suppressErrors ? this.logSuppressedError(reason) : Promise.reject(reason));
                }
            }
        }

        public emit(events: LogEvent[]) {
            let filteredEvents = this.levelSwitch
                        ? events.filter(e => this.levelSwitch.isEnabled(e.level))
                                    : events;

            if (!filteredEvents.length) {
                return Promise.resolve<LogEvent[]>();
            }

            return this.sendToServer(filteredEvents);
        }

        private getAppname(properties): string {
            if ('appname' in properties) {
                return properties["appname"];
            }
    
            return "unknown";
        }

        private sendToServer(events: LogEvent[]): Promise<any> {
            let logs = events.map(e => {
                let mappedEvent = {
                    level: this.mapLogLevel(e.level),
                    message: e.messageTemplate.raw,
                    properties: e.properties,
                    dt: e.timestamp,
                    platform: "browser",
                    osplatform: "browser"
                };
    
                mappedEvent["syslog"] = {
                    appname: this.getAppname(e.properties),
                    host: "localhost",
                    hostname: "localhost"
                };
    
                mappedEvent["syslog"]["logtail@11993"] = {};
    
                if (e.error instanceof Error && e.error.stack) {
                    Object.assign(mappedEvent["syslog"]["logtail@11993"], { "ExceptionDetail": e.error.stack });
                }
    
                return mappedEvent;
            });
    
            const body = JSON.stringify(logs);
    
            let storageKey;
            if (this.durable) {
                storageKey = `structured-log-betterstack-sink-${new Date().getTime()}-${Math.floor(Math.random() * 1000000) + 1}`;
                localStorage.setItem(storageKey, body);
            }
    
            return this.sendRecord(body, null)
                .then(() => {
                    if (storageKey) {
                        localStorage.removeItem(storageKey);
                    }
                })
                .catch(reason => this.suppressErrors ? this.logSuppressedError(reason) : Promise.reject(reason));
        }

        private sendRecord(body: any, done: any) : Promise<void | string> {
            const promise = fetch(this.ingestionAddress, {
                headers: {
                    "Authorization": `Bearer ${this.token}`,
                    "Content-Type": "application/json"
                },
                method: "POST",
                body: body
            });
    
            return !done ? promise : promise.then(response => done(response));
        }

        private logSuppressedError(reason): void {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('Suppressed error when logging to Betterstack: ' + reason);
            }
        }

        private mapLogLevel(level) {
            return this.levelMapping[level];
        }

        public toString(): string {
            return 'BetterStackSink';
        }
    
        public flush(): Promise<void> {
            return Promise.resolve();
        }
  }