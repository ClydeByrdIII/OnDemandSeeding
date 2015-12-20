For a project I created on-demand bittorrent seeders using local embedded systems and AWS EC2 instances.
When a swarm for a torrent has more leechers than seeders, it's possible to have a slow or unreliable torrenting session.
If you are the seeder and want to lighten the load on your seeder and temporarily generate a potentially faster, more reliable
torrent session. This is not ideal for the average consumer, although if you stay within AWS EC2 free tier every one benefits.

This implementation uses Transmission as the bittorrent client, but an example with uTorrent was also implemented too.
Each ec2 instance was setup to be copies of a single snapshot that all had deluge and deluge-web installed and ran on startup.
They all had a copy of the same set of files. It's up to you to setup these instances to properly seed when running.
I followed [this article](http://www.howtogeek.com/142044/how-to-turn-a-raspberry-pi-into-an-always-on-bittorrent-box/) to setup deluge on all my seeders including my local embedded systems (raspberry pi 2 and beaglebone black).

AWS credentials were stored in my ~/.aws/credential file

The project uses node.js and python. 
It requires for Transmissions web portion to be enabled

The file "onDemandSeeding.js" does most of the work.

It adds additional seeders to a given torrent file if it falls below a given ratio [0, 1].

for a 1 to 1  relationship with seeders and leechers try
python onDemandSeeding.js filename.txt 1

For testing purposes you can also manually input the number of seeders and leechers in the swarm.
let's say there are 3 seeders and 8 leechers
node onDemandSeeding.js filename.txt 1 3 8

so usage is

python onDemandSeeding.js <filename> <ratio> <optional num_seeders> <optional num_leechers>

The file "smallServer.py" is what your embedded systems run to start and kill bittorrent sessions when needed.

python smallServer.py

*** Potentially not functional; after some style changes. I'd test them but I already got rid of the aws services, because I'm cheap *** 