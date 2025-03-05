import {pinoLogger} from 'hono-pino'
import pino from 'pino';
import PinoPretty from 'pino-pretty';

export function PinoLogger(){
    return pinoLogger({
        // pino: pino(process.env.NODE_ENVIRONEMNT !== "production" ? undefined : PinoPretty()),
        pino: pino(
            PinoPretty({
                ignore: 'apiKey'
            }),
    ),
        http: {
            reqId: () => crypto.randomUUID(),
        }
});
}