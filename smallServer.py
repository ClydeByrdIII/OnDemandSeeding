import json
import socket
import threading
import SocketServer
import subprocess
from subprocess import call

def get_ip_address():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    return s.getsockname()[0]

class ThreadedDeviceRequestHandler(SocketServer.BaseRequestHandler):

    def handle(self):
        
        dev_data = self.request.recv(1024)
        print dev_data
        data = json.loads(dev_data)
        if data['command'] == 'start':
            print 'start servers'
            deluged = subprocess.Popen('deluged', shell=True)
            deluge_web = subprocess.Popen('deluge-web &', shell=True)
            deluged.wait()
            deluge_web.wait()
        elif data['command'] == 'stop':
            print 'Killing servers'
            call (["pkill deluge"], shell=True)
        else:
            print 'Not a command'
        return

class ThreadedDeviceServer(SocketServer.ThreadingMixIn, SocketServer.TCPServer):
    pass

if __name__ == '__main__':

    ip = get_ip_address()
    port = 5050
    print 'IPADDR:' + ip + ' on Port:' + str(port) 
    address = (ip, port) # let the kernel give us a port
    server = ThreadedDeviceServer(address, ThreadedDeviceRequestHandler)
    server.allow_reuse_address = True

    t = threading.Thread(target=server.serve_forever)
    t.setDaemon(True) # don't hang on exit
    t.start()
    print 'Server loop running in thread:', t.getName()
    
    # Don't exit
    while True:
      pass
