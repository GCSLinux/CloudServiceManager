import YAML from 'yaml';
import fs from 'fs';
import net from 'net';
import * as http from 'http';
import * as util from 'util';
import Docker from 'dockerode';
import { spawn } from 'child_process';
const os = require('os');
import { ProcedureStatus, GcsService } from './Service';

import { file_root, SOCKET_PATH, GlobalDocker } from './Constants';

const socketPath = '/var/run/docker.sock';

function RequestDocker(
    path: string,
    method: string = 'GET',
    data ? : string | object
): Promise < string > {
    return new Promise((resolve, reject) => {
        // Create a Unix socket connection
        const client = net.createConnection(socketPath);

        // Handle socket connection errors
        client.on('error', (err) => {
            reject(err);
        });

        // Send an HTTP request to the Docker socket
        client.on('connect', () => {
            const options: http.RequestOptions = {
                socketPath,
                method,
                path,
            };

            if (data) {
                let length = 0;
                //data is json
                if (typeof data === 'object') {
                    data = JSON.stringify(data);
                    length = Buffer.from(data).length;
                } else {
                    length = Buffer.from(data).length;
                }
                options.headers = {
                    'Content-Length': length,
                    'Content-Type': 'application/json',
                };
            }

            const request = http.request(options, (response) => {
                let responseData = '';

                // Read the response data
                response.on('data', (chunk) => {
                    responseData += chunk;
                });

                // Handle the end of the response
                response.on('end', () => {
                    // Close the socket connection
                    client.end();

                    // Resolve with the response data
                    resolve(responseData);
                });
            });

            // Handle request errors
            request.on('error', (err) => {
                reject(err);
            });

            // Send the request body if data is provided
            if (data) {
                request.write(data);
            }

            // End the request
            request.end();
        });
    });
}



export {RequestDocker}