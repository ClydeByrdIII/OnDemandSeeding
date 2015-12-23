var net = require('net');
/* If you wanted to operate on multiple regions you
 * would need to create multiple ec2 instances for each region
 */
var AWS = require("aws-sdk");
AWS.config.update({region: "us-east-1"});
var ec2 = new AWS.EC2({apiVersion: "latest"});

var Transmission = require('transmission');
var transmission = new Transmission(
    {
        'host': 'localhost',
        'port': 9091,
        'username': 'YOUR USER',
        'password': 'YOUR PASSWORD'
    }        
);

/* setup constraints and global vars */

// stores IDs of stopped instances
var availableInstances = [];

// stores IDs of running instances
var runningInstances = [];

// local embedded systems that can be seeders 
// (Currently beaglebone black and raspberry pi 2)
// add your own IP addresses to the array.
// make array empty if using no embedded systems
var embeddedInstances = ['X.X.X.X', 'X.X.X.X'];

// min file size
var SIZE_MIN = 52428800;

// max number of seeds available; is set on instance population
var MAX_SEED = -1;

// max time for instances to seed (in milliseconds) (arbitrary number)
var MAX_TIME = 60000 * 10;

// periodic poll (in milliseconds) (also arbitrary)
var POLL_TIME = 60000 * 1;

// used for testing purposes to force instances to come online
var SEEDS    = undefined;
var PEERS    = undefined;

// tells if any instances are running currently
var seedersOnline = false;

// used to store javascript timers, so they can be cleared
// if max seeding time occurs
var timers = [];

// just for formatting
var bar = "----------------------"

/* helper functions */
function instanceLogMaker(errorMsg, successMsg, instances) {
  return function(err, data)
      {
        if (err) {
          console.log(errorMsg);
          console.log(err, err.stack);
        } else {
          console.log(successMsg);
          console.log(bar);

          var instances = data[instances];
          for (var i = 0; i < instances.length; i++)
            console.log(instances[i].InstanceId);

          console.log(bar);
        }
      };
}

// function to bring seeders online
function addSeeders(numSeeders, monitorArgs)
{
  if (numSeeders < 1)
    return;
  // if no embedded Instances skip this check
  if (embeddedInstances.length == 0) {
    if (numSeeders < (embeddedInstances.length + 1)) {
      // bring the embedded, local seeders online before trying ec2 instances
      for (var i = 0; i < numSeeders; i++) {
        runningInstances.push(embeddedInstances[i]);
        // need to ensure each socket sends to each seeder
        (function(i, client) {
          client.connect(5050, embeddedInstances[i],
            function ()
            {
              client.write(JSON.stringify({'command': 'start'}));
            }
          );

          // start polling after the last seeder is online
          if (i + 1 == numSeeders) {
            client.on('end', function()
            {

              seedersOnline = true;
              console.log("ODS: check again in %d seconds", POLL_TIME/1000);

              // only seed for MAX TIME seconds
              timers.push(setTimeout(
                function()
                {
                  console.log("MAX Seeding Time reached; Remove additonal seeders");
                  removeSeeders();
                },
                MAX_TIME));

              // keep track of the polling timeout;
              timers.push(setTimeout(monitor, POLL_TIME, monitorArgs[0], monitorArgs[1]));
            });
          }
        })(i, new net.Socket());
      }
      return;
    }
  }
  // use ec2 instances for seeding
  for (var i = 0; i < numSeeders; i++)
    runningInstances.push(availableInstances[i]);

  ec2.startInstances({"InstanceIds": runningInstances},
    instanceLogMaker("startInstances Error",
      "Starting instances:",
      "StartingInstances"));

  // wait for them to come online
  ec2.waitFor("instanceRunning", {"InstanceIds": runningInstances},
    function(err, data)
    {
      if (err) {
        console.log("waitFor instanceRunning error");
        console.log(err, err.stack);
      } else {
        console.log("Instances started:");
        console.log(bar);

        for (var item in data.Reservations) {
          var instances = data.Reservations[item].Instances;
          for (var instance in instances)
            console.log(instances[instance].InstanceId);
        }

        console.log(bar);
        // instances are online; start polling
        seedersOnline = true;
        // only seed for MAX TIME seconds
        timers.push(setTimeout(
          function()
          {
            console.log("MAX Seeding Time reached; Remove additional seeders");
            removeSeeders();
          },
          MAX_TIME));

        console.log("ODS: check again in %d seconds", POLL_TIME/1000);
        timers.push(setTimeout(monitor, POLL_TIME, monitorArgs[0], monitorArgs[1]));
      }
  });
}

function removeSeeders()
{
  // don't get interrupted by other timeouts
  for (var tid = 0; tid < timers.length; tid++)
    clearTimeout(timers[tid]);

  timers.length = 0;
  // if there are no embedded systems skip this check
  if (embeddedInstances.length == 0) {
    if (runningInstances.length < (embeddedInstances.length + 1)) {

        for (var i = 0; i < runningInstances.length; i++) {
          (function(i, client)
          {
            client.connect(5050, runningInstances[i],
              function ()
              {
                client.write(JSON.stringify({'command': 'stop'}));
              }
            );

            if (i + 1 == runningInstances.length) {
              console.log("Stop")
              client.on('end',
                function()
                {
                  seedersOnline = false;
                  runningInstances.length = 0;
                  // kill the program
                  console.log("Seeding finished");
                  process.exit();
                }
              );
            }
          }
          )(i, new net.Socket());
        }
        return;
    }
  }

  ec2.stopInstances({"InstanceIds": runningInstances},
    instanceLogMaker("stopInstances Error",
      "Stopping Instances:",
      "StoppingInstances"));

   // wait for them to be offline
  ec2.waitFor("instanceStopped", {"InstanceIds": runningInstances}, 
    function(err, data)
    {
      if (err) {
        console.log("waitfor instanceStopped Error");
        console.log(err, err.stack); // an error occurred 
      } else {
        console.log("Instances stopped:");
        console.log(bar);

        for (var item in data.Reservations) {
          var instances = data.Reservations[item].Instances;
          for (var instance in instances)
            console.log(instances[instance].InstanceId);
        }

        console.log(bar);

        seedersOnline = false;

        /*  we're killing the program, 
            but I may have it do something else later 
        */
        runningInstances.length = 0;
        console.log("Seeding finished");
        process.exit();
      }
    }
  );
}

function isRatioBad(seeds, peers, ratio) {
  if ((peers > 0) && (seeds/peers < ratio))
    return true;
  return false;
}

function removeSeedersIfNecessary(torrent, ratio)
{
  var name      = torrent.name;
  var size      = Number(torrent.sizeWhenDone);
  var seeds     = Number(torrent.trackerStats[0].seederCount);
  var peers     = Number(torrent.trackerStats[0].leecherCount);
  var peersCon  = Number(torrent.peersConnected);
  peers         = Math.max(peers, peersCon);

  // if seed and peers were passed in use them
  if (SEEDS != undefined)
    seeds = Number(SEEDS);

  if (PEERS != undefined)
    peers = Number(PEERS);
  // this means peers is definitly not zero
  if (peersCon > 0)
    console.log("File %s has a current s:l ratio of %d", name, seeds/peers);

  console.log("There are %d additional Seeders", runningInstances.length);
  
  if (SEEDS != undefined) {
    console.log("There are %d reg seeders", seeds - runningInstances.length);
    seeds -= runningInstances.length;
  } else {
    console.log("There are %d reg seeders", seeds);
  }

  // are there still any peers left?
  if (peersCon < 1) {
    console.log("No more peers for file %s; Remove additional seeders", name);
    removeSeeders();
  } else if (!(isRatioBad(seeds, peers, ratio))) {
    console.log("Ratio is good enough; Remove additional seeders", name);
    removeSeeders();
  } else {
    console.log("RIN: Check again in %d seconds", POLL_TIME/1000);
    timers.push(setTimeout(monitor, POLL_TIME, name, ratio));
  }
}

function addSeedersIfNecessary(torrent, ratio) {
  var name      = torrent.name;
  var size      = Number(torrent.sizeWhenDone);
  var seeds     = Number(torrent.trackerStats[0].seederCount);
  var peers     = Number(torrent.trackerStats[0].leecherCount);
  var peersCon  = Number(torrent.peersConnected);
  peers         = Math.max(peers, peersCon);

  // if seed and peers were passed in use them
  if (SEEDS != undefined)
    seeds = Number(SEEDS);

  if (PEERS != undefined) {
    peers = Number(PEERS);
    peersCon = 1;
  }

  if (size < SIZE_MIN) {
    console.log("File %s needs to be at least %d bytes; It is %d bytes",
      name, SIZE_MIN, size);
    return;
  }

  // Are more seeders necessary?
  if ((peersCon > 0) && (isRatioBad(seeds, peers, ratio))) {
    // the total number of seeds needed for the given ratio
    var totSeeds = Math.ceil(peers * ratio);
    var neededSeeds = totSeeds - seeds;

    // at max start MAX_SEED number of seeds
    var numSeeds = Math.min(neededSeeds, MAX_SEED);

    console.log("current ratio %d Wanted ratio %d new ratio %d", seeds/peers, ratio, (numSeeds + seeds)/peers);
    console.log("Needed %d seeds; Adding %d seeders", neededSeeds, numSeeds);
    if (SEEDS != undefined)
      SEEDS = numSeeds + seeds;

    addSeeders(numSeeds, [name, ratio]);
  } else if (peersCon < 1) {
    console.log("File %s no Peers connected; Not necessary to boost", name);
  } else {
    console.log("File %s has a decent s:l ratio of %d", name, seeds/peers);
  }
}

/* check if "filename"'s swarm ratio is sufficient */
function monitor (filename, ratio)
{ 
  // remove the last timer in the array; it's expired
  timers.pop();
  transmission.get(
    function(err, torrents_list)
    {
      if (err) { 
        console.log("Error found during \"torrent-get\" call on transmission");
        console.log(err);
        return;
      }

      // search for torrent
      var torrents = torrents_list.torrents;
      var torIndex = -1;
      for (var idx = 0; idx < torrents.length; idx++) {
        if (torrents[idx]['name'] === filename) {
          torIndex = idx;
          break;
        }
      }

      if (torIndex < 0) {
        console.log("Couldn't find file %s", filename);
        return;
      }
    
      // search for seeders and leechers in swarm
      var torrent = torrents_list.torrents[torIndex];
      var i = 0;
      for (; i < torrent.trackerStats.length; i++)
        if (torrent.trackerStats[i].seederCount > -1)
          break;

      if (i == torrent.trackerStats.length) {
        console.log("All trackers are down; Can't get swarm info");
        return;
      }
      // the functions that operate on this variable assume index 0 contains valid stats
      torrent.trackerStats[0].seederCount  = torrent.trackerStats[i].seederCount;
      torrent.trackerStats[0].leecherCount = torrent.trackerStats[i].leecherCount;
      console.log("Hash %s has name '%s' and size %d; Seeder:Leecher %d:%d Peers Connected %d", 
        torrent.hashString,
        torrent.name,
        torrent.sizeWhenDone,
        torrent.trackerStats[0].seederCount,
        torrent.trackerStats[0].leecherCount,
        torrent.peersConnected
      );
      
      if (seedersOnline)
        removeSeedersIfNecessary(torrent, ratio);
      else
        addSeedersIfNecessary(torrent, ratio);
    }
  );
}

function main()
{
  var args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node torrent.js <filename> <ratio of seeder to leecher in decimal form> <optional: numSeeds> <optional: num_peers>");
    console.log("Example: node torrent.js test.iso .30");
    return;
  }

  if (isNaN(args[1])) {
    console.log("Ratio must be a number");
    return;
  }

  var filename = args[0];
  var ratio    = args[1];
  SEEDS    = args[2];
  PEERS    = args[3];

  monitor(filename, ratio);
}

// populate available instance array with available (stopped) instances then call main
ec2.describeInstances(
  {
    'Filters': 
      [
        {
          'Name': 'instance-state-name',
          'Values': ['stopped']
        }
      ]
  },
  function(error, data) 
  {
    if (error) {
      console.log("Error populating instances");
      console.log(error);
    } else {
      for (var item in data.Reservations) {
        var instances = data.Reservations[item].Instances;
        for ( var instance in instances)
          availableInstances.push(instances[instance].InstanceId);
      }

      MAX_SEED = availableInstances.length;
      main();
    }   
  }
);
