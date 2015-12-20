# On-Demand BitTorrent Seeding
For a project I created on-demand BitTorrent seeders using local embedded systems and AWS EC2 instances.
When a swarm for a torrent has more leechers than seeders, it's possible to have a slow or unreliable torrenting session.
If you are the seeder and want to lighten the load on your machine and network, this may be of interest to you.
You can temporarily generate a potentially faster, more reliable torrent session by adding EC2 instances from different geographical areas to remove location bottlenecks and have a larger upload capacity.
This is not ideal for the average consumer, although if you stay within AWS EC2 free tier it could be useful.
You could also look in to the Github student pack + Amazon educate to receive over $115 in AWS credit

## Motivation for this project
This was my term project for umich eecs 589 advanced networking class.
I came up with it while trying to add virtualization to some aspect of "On-demand + X". Unfortunately the virtualization aspect of Docker containers didn't work out, but I'm not complaining about the results. I actually don't torrent things legally or illegally or know too much about torrenting beyond what I researched for this project.

## Implementation
This implementation uses Transmission as the BitTorrent client, but an example with uTorrent was also implemented too.
### BitTorrenting on EC2
Each EC2 instance was setup to be copies of a single AMI that all had deluge and deluge-web installed and ran on startup.
They each had a copy of the same set of files. It's up to you to setup these instances to properly seed when running.
Each EC2 instance was a [T2.micro instance](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/t2-instances.html). AWS has a default limit of 20 running T2.micro instances at one time, but you can request for a higher limit. I had them setup with 15 GB volumes.

I followed [this article](http://www.howtogeek.com/142044/how-to-turn-a-raspberry-pi-into-an-always-on-bittorrent-box/) to setup deluge on all my seeders including my local embedded systems (raspberry pi 2 and beaglebone black). 

I followed [this article] (http://mwmanning.com/2010/11/29/EC2-Micro-Instance-as-a-Remote-Bittorrent-Client.html) for help setting up EC2 instances for BitTorrenting.

The project uses node.js and python.
It requires for Transmission's web server to be enabled.
AWS credentials were stored in my [~/.aws/credential file]
(https://blogs.aws.amazon.com/security/post/Tx3D6U6WSFGOK2H/A-New-and-Standardized-Way-to-Manage-Credentials-in-the-AWS-SDKs).

## Usage
The file "onDemandSeeding.js" does most of the work.
It adds additional seeders to a given torrent file if it falls below a given ratio [0, 1].
If less than 3 seeders are needed it will use local embedded systems, anything greater it starts ec2 instances (that are already created and stopped). You can remove this code if you want.

It will exit when:

* Your seeder has no connected peers
* The seeder to leecher ratio (slr) reaches or exceeds the given ratio without additional seeders
* The slr was already sufficient

Exceptions being error handling like trackers being down, file not found, my inability to properly catch errors etc

Usage:

```shell
node onDemandSeeding.js <filename (not the .torrent file)> <ratio [0, 1]> <optional num_seeders> <optional num_leechers>
```

For a 1 to 1 relationship with seeders and leechers try:

```shell
node onDemandSeeding.js filename.txt 1
```

For testing purposes you can also manually input the number of seeders and leechers in the swarm.
This will at least work for one round of monitoring swarm statistics.
If you want to say there are 3 seeders and 8 leechers and you want a 1 seeder per 2 leechers:

```shell
node onDemandSeeding.js filename.txt .5 3 8
```

The file "smallServer.py" is what your embedded systems would run to start and kill BitTorrent sessions when needed.
```shell
python smallServer.py
```

*** Potentially not functional; after some style changes. I'd test them, but I already got rid of the AWS services, because I'm paranoid/cheap ***
