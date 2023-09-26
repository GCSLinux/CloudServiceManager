import fs from 'fs';
import net from 'net';
import * as ServiceUtils from './ServiceUtils';
import * as DockerUtils from './DockerUtils';
import { SOCKET_PATH } from './Constants';
import { GcsService } from './Service';
import {Log} from './Log';
import { MkError, MkInfo } from './ServiceUtils';
function HandleCommand(input: any) : any {
    
    if (input.command == 'start') return ServiceUtils.StartService(input.service);
    if (input.command == 'stop') return ServiceUtils.StopService(input.service);
    if (input.command == 'install') return ServiceUtils.InstallService(input.service);
    if (input.command == 'load') return ServiceUtils.LoadService(input.service);
    if (input.command == 'list') return ServiceUtils.ListServices();

    return MkError('Invalid command');

}

//create a unix socket server
const server = net.createServer((client: any) => {
    client.on('data', (data: any) => {
        //convert data to json
        let json = JSON.parse(data);
        //handle command
        let response = HandleCommand(json);
        //send response
        client.write(JSON.stringify(response));
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