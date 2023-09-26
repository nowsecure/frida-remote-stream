import EventEmitter from "events";
import { Readable, Writable } from "stream";
import type { TypedEmitter } from "tiny-typed-emitter";

export class Controller {
    events = new EventEmitter() as TypedEmitter<ControllerEvents>;

    private handlers: { [stanzaName: string]: (payload: any, data: Buffer | null) => void };

    private sources = new Map<number, Source>();
    private nextEndpointId = 1;

    private requests = new Map<StanzaId, RequestCallbacks>();
    private nextRequestId = 1;

    constructor() {
        this.handlers = {
            ".create": this.onCreate,
            ".finish": this.onFinish,
            ".write": this.onWrite
        };
    }

    open(label: string, details: StreamDetails = {}): OutgoingStream {
        const endpoint: Endpoint = {
            id: this.nextEndpointId++,
            label,
            details
        };
        return new Sink(this, endpoint);
    }

    receive(packet: Packet): void {
        const stanza = packet.stanza as Stanza;
        const { id, name, payload } = stanza;

        const type = name[0];
        if (type === ".") {
            this.onRequest(id, name, payload, packet.data);
        } else if (type === "+") {
            this.onNotification(id, name, payload);
        } else {
            throw new Error("Unknown stanza: " + name);
        }
    }

    private onCreate = (payload: CreateRequest): void => {
        const endpoint = payload.endpoint;

        const source = new Source(endpoint);
        this.sources.set(endpoint.id, source);

        this.events.emit("stream", source);
    };

    private onFinish = (payload: FinishRequest): void => {
        const id = payload.endpoint.id;

        const source = this.sources.get(id);
        if (source === undefined) {
            throw new Error("Invalid endpoint ID");
        }

        this.sources.delete(id);
        source.push(null);
    };

    private onWrite = (payload: WriteRequest, data: Buffer | null): Promise<void> => {
        const id = payload.endpoint.id;

        const source = this.sources.get(id);
        if (source === undefined) {
            throw new Error("Invalid endpoint ID");
        }

        if (data === null) {
            throw new Error("Invalid request: missing data");
        }

        return source.deliver(data);
    };

    _request(name: StanzaName, payload: StanzaPayload, data: Buffer | null) {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId++;

            this.requests.set(id, {
                resolve: resolve,
                reject: reject
            });

            const stanza: Stanza = {
                id,
                name,
                payload
            };
            this.events.emit("send", {
                stanza,
                data
            });
        });
    }

    private onRequest(id: StanzaId, name: StanzaName, payload: StanzaPayload, data: Buffer | null): void {
        const handler = this.handlers[name];
        if (handler === undefined) {
            throw new Error(`Invalid request: ${name}`);
        }

        let result: any;
        try {
            result = handler(payload, data);
        } catch (e) {
            this.reject(id, e as Error);
            return;
        }

        if (result instanceof Promise) {
            result
                .then(value => this.resolve(id, value))
                .catch(error => this.reject(id, error))
        } else {
            this.resolve(id, result);
        }
    }

    private resolve(id: StanzaId, value: StanzaPayload): void {
        const stanza: Stanza = {
            id: id,
            name: "+result",
            payload: value
        };
        this.events.emit("send", {
            stanza,
            data: null
        });
    }

    private reject(id: StanzaId, error: Error): void {
        const stanza: Stanza = {
            id: id,
            name: "+error",
            payload: {
                message: error.toString()
            }
        };
        this.events.emit("send", {
            stanza,
            data: null
        });
    }

    private onNotification(id: StanzaId, name: StanzaName, payload: StanzaPayload): void {
        const request = this.requests.get(id);
        if (request === undefined) {
            throw new Error("Invalid request ID");
        }
        this.requests.delete(id);

        if (name === "+result") {
            request.resolve(payload);
        } else if (name === "+error") {
            const response = payload as ErrorResponse;
            request.reject(new Error(response.message));
        } else {
            throw new Error("Unknown notification: " + name);
        }
    }
}

export default Controller;

type ControllerEvents = {
    stream: (stream: IncomingStream) => void;
    send: (packet: Packet) => void;
};

interface RequestCallbacks {
    resolve: (value: StanzaPayload) => void;
    reject: (error: Error) => void;
}

export interface IncomingStream extends Readable {
    label: string;
    details: StreamDetails;
}

export interface OutgoingStream extends Writable {
}

export interface StreamDetails {
    [key: string]: any;
}

export interface Packet {
    stanza: {
        [key: string]: any;
    };
    data: Buffer | null;
}

interface Stanza {
    id: StanzaId;
    name: StanzaName;
    payload: StanzaPayload
}

type StanzaId = number;

type StanzaName = string;

interface StanzaPayload {
    [key: string]: any;
}

interface CreateRequest {
    endpoint: Endpoint;
}

interface FinishRequest {
    endpoint: Endpoint;
}

interface WriteRequest {
    endpoint: Endpoint;
}

interface ErrorResponse {
    message: string;
}

interface Endpoint {
    id: number;
    label: string;
    details: StreamDetails
}

class Source extends Readable implements IncomingStream {
    label: string;
    details: StreamDetails;

    private onReadComplete: ReadCallback | null = null;
    private delivery: PendingDelivery | null = null;

    constructor({ label, details }: Endpoint) {
        super();

        this.label = label;
        this.details = details;
    }

    _read(size: number): void {
        if (this.onReadComplete !== null) {
            return;
        }

        this.onReadComplete = chunk => {
            this.onReadComplete = null;

            if (chunk.length === 0) {
                this.push(null);
                return false;
            }

            if (this.push(chunk)) {
                this._read(size);
            }
            return true;
        };
        this.tryComplete();
    }

    deliver(chunk: Buffer): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.delivery !== null) {
                throw new Error("Protocol violation");
            }

            this.delivery = {
                chunk: chunk,
                resolve: resolve,
                reject: reject
            };
            this.tryComplete();
        });
    }

    private tryComplete(): void {
        const { onReadComplete, delivery } = this;
        if (onReadComplete === null || delivery === null) {
            return;
        }
        this.onReadComplete = null;
        this.delivery = null;

        if (onReadComplete(delivery.chunk)) {
            delivery.resolve();
        } else {
            delivery.reject(new Error("Stream closed"));
        }
    }
}

type ReadCallback = (chunk: Buffer) => boolean;

interface PendingDelivery {
    chunk: any;
    resolve: () => void;
    reject: (error: Error) => void;
}

class Sink extends Writable implements OutgoingStream {
    constructor(
            private controller: Controller,
            private endpoint: Endpoint) {
        super();

        this.controller._request(".create", { endpoint: this.endpoint }, null);
        this.once("finish", this._onFinish.bind(this));
    }

    _write(chunk: any, encoding: any, callback: any): void {
        this.controller._request(".write", { endpoint: this.endpoint }, chunk)
            .then(_ => callback())
            .catch(error => callback(error));
    }

    _onFinish(): void {
        this.controller._request(".finish", { endpoint: this.endpoint }, null);
    }
}
