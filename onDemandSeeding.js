var net = require('net');

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

// instances available
var instanceIDs = [];

// instances currently running
var runningInstances = [];

// local embedded systems that can be seeders 
// (Currently beaglebone black and raspberry pi 2)
// add your own IP addresses to the array.
var embeddedInstances = ['X.X.X.X', 'X.X.X.X'];

// min file size
var SIZE_MIN = 52428800;

// max number of seeds available; is set in instance population

var MAX_SEED = -1;

// max time for instances to seed (in milliseconds) (arbitrary number)
var MAX_TIME = 60000 * 10;

// periodic poll (in milliseconds) (also arbitrary)
var POLL_TIME = 60000 * 1;

// used for testing purposes to force instances to come online
var SEEDS    = undefined;
var PEERS    = undefined;

// tells if any instances are running currently
var seeders_online = false;

// used to store javascript timers, so they can be cleared
// if max seeding time occurs
var timers = [];

// just for formatting
var bar = "----------------------"

// function to bring seeders online
function addSeeders(num_seeders, mon_args)
{
  if (num_seeders < 1)
    return;

  if (num_seeders < 3) {
    // bring the embedded, local seeders online before trying ec2 instances
    for (var i = 0; i < num_seeders; i++) {
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
        if (i + 1 == num_seeders) {
          client.on('end', function()
          {

            seeders_online = true;
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
            timers.push(setTimeout(monitor, POLL_TIME, mon_args[0], mon_args[1]));
          });
        }
      })(i, new net.Socket());
    }
  } else {
    // use ec2 instances for seeding
    for (var i = 0; i < num_seeders; i++)
      runningInstances.push(instanceIDs[i]);

    ec2.startInstances({"InstanceIds": runningInstances}, 
      function(err, data)
      {
        if (err) {
          console.log("startInstances Error");
          console.log(err, err.stack);
        } else {
          console.log("Starting instances:");
          console.log(bar);

          var instances = data.StartingInstances;
          for (var i = 0; i < instances.length; i++)    
            console.log(instances[i].InstanceId);

          console.log(bar);
        }
      }
    );

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
          seeders_online = true;
          // only seed for MAX TIME seconds
          timers.push(setTimeout(
            function()
            {
              console.log("MAX Seeding Time reached; Remove additional seeders");
              removeSeeders();
            },
            MAX_TIME));
          
          console.log("ODS: check again in %d seconds", POLL_TIME/1000);
          timers.push(setTimeout(monitor, POLL_TIME, mon_args[0], mon_args[1]));
        }
    });
  }
}

function removeSeeders()
{
  // don't get interuppted by other timeouts
  for (var tid = 0; tid < timers.length; tid++)
    clearTimeout(timers[tid]);

  timers.length = 0;
  if (runningInstances.length < 3) {

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
                seeders_online = false;
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

  ec2.stopInstances({"InstanceIds": runningInstances},
    function(err, data)
    {
      if (err) {
        console.log("stopInstances Error");
        console.log(err, err.stack);
      } else {
        console.log("Stopping Instances:");
        console.log(bar);

        var instances = data.StoppingInstances;
        for (var i = 0; i <  instances.length; i++)    
          console.log(instances[i].InstanceId);

        console.log(bar);
      }
    }
  );

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

        seeders_online = false;

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

function remove_seeders_if_necessary(torrent, ratio) 
{
  var name      = torrent.name;
  var size      = Number(torrent.sizeWhenDone);
  var seeds     = Number(torrent.trackerStats[0].seederCount);
  var peers     = Number(torrent.trackerStats[0].leecherCount);
  var peers_con = Number(torrent.peersConnected);
  peers         = Math.max(peers, peers_con);

  // if seed and peers were passed in use them
  if(SEEDS != undefined)
    seeds = Number(SEEDS);

  if(PEERS != undefined)
    peers = Number(PEERS);
  // this means peers is definitly not zero
  if(peers_con > 0)
    console.log("File %s has a current s:l ratio of %d", name, seeds/peers);

  console.log("There are %d additional Seeders", runningInstances.length);
  
  if(SEEDS != undefined) {
    console.log("There are %d reg seeders", seeds - runningInstances.length);
    seeds -= runningInstances.length;
  } else {
    console.log("There are %d reg seeders", seeds);
  }

  // are there still any peers left?
  if (peers_con < 1){
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

function isRatioBad(seeds, peers, ratio) {
  if ((peers > 0) && (seeds/peers < ratio)) 
    return true;
  return false;
}

function add_seeders_if_necessary(torrent, ratio) {
  var name      = torrent.name;
  var size      = Number(torrent.sizeWhenDone);
  var seeds     = Number(torrent.trackerStats[0].seederCount);
  var peers     = Number(torrent.trackerStats[0].leecherCount);
  var peers_con = Number(torrent.peersConnected);
  peers         = Math.max(peers, peers_con);

  // if seed and peers were passed in use them
  if(SEEDS != undefined)
    seeds = Number(SEEDS);

  if(PEERS != undefined) {
    peers = Number(PEERS);
    peers_con = 1;
  }

  // is file big enough?
  if (size < SIZE_MIN) {
    console.log("File %s needs to be at least %d bytes; It is %d bytes",
      name, SIZE_MIN, size);
    return;
  }

  // Are more seeders necessary?
  if ((peers_con > 0) && (isRatioBad(seeds, peers, ratio))) {
    // the total number of seeds need for the given ratio
    var tot_seeds = Math.ceil(peers * ratio);
    var needed_seeds = tot_seeds - seeds;

    // at max start MAX_SEED number of seeds
    var num_seeds = Math.min(needed_seeds, MAX_SEED);

    console.log("current ratio %d Wanted ratio %d new ratio %d", seeds/peers, ratio, (num_seeds + seeds)/peers);
    console.log("Needed %d seeds; Adding %d seeders", needed_seeds, num_seeds);
    if(SEEDS != undefined)
      SEEDS = num_seeds + seeds;

    addSeeders(num_seeds, [name, ratio]);
  } else if (peers_con < 1) {
    console.log("File %s no Peers connected; Not necessary to boost", name);
  } else {
    console.log("File %s has a decent s:l ratio of %d", name, seeds/peers);
  }
}

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
      var tor_index = -1;
      for (var idx = 0; idx < torrents.length; idx++) {
        if (torrents[idx]['name'] === filename) {
          tor_index = idx;
          break;
        }
      }

      if (tor_index < 0) {
        console.log("Couldn't find file %s", filename);
        return;
      }
    
      // search for seeders and leechers in swarm
      var torrent = torrents_list.torrents[tor_index];
      var i = 0;
      for(; i < torrent.trackerStats.length; i++)
        if(torrent.trackerStats[i].seederCount > -1)
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
      
      if (seeders_online)
        remove_seeders_if_necessary(torrent, ratio);
      else
        add_seeders_if_necessary(torrent, ratio);
    }
  );
}

function main()
{
  var args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node torrent.js <filename> <ratio of seeder to leecher in decimal form> <optional: num_seeds> <optional: num_peers>");
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

// populate instanceId array with available (stopped) instances then call main
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
    if(error) {
      console.log("Error populating instances");
      console.log(error);
    } else {
      for( var item in data.Reservations) {    
        var instances = data.Reservations[item].Instances;
        for ( var instance in instances)
          instanceIDs.push(instances[instance].InstanceId);
      }

      MAX_SEED = instanceIDs.length;
      main();
    }   
  }
);
