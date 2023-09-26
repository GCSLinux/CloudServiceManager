import fs from 'fs';
import net from 'net';
import * as ServiceUtils from './ServiceUtils';
import * as DockerUtils from './DockerUtils';
import { SOCKET_PATH } from './Constants';
import { GcsService } from './Service';
import {Log} from './Log';

//create a unix socket server
const server = net.createServer((client: any) => {
    client.on('data', (data: any) => {
        //convert data to json
        let json = JSON.parse(data);
        //retrn empty json
        client.write(JSON.stringify({}));
    });
});

server.on('error', (err: any) => {
    console.log(err);
});

server.on('close', () => {
    console.log('server closed');
    if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }
    Log('Stopping all services');
    ServiceUtils.StopAllServices();
});

process.on('uncaughtException', (err: any) => {
    Log(err.message, 'error');
    server.close();
});


//start listening on socket, if socket is already in use, delete it
function Main() {
    if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }
    server.listen(SOCKET_PATH, () =>{
        Log('Server listening on ' + SOCKET_PATH);
    });
}

Main();