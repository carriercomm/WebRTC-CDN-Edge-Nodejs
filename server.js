//////////////////////////////////////////////////////////
///                              設定                                        ///
//////////////////////////////////////////////////////////
var os = require('os');
var ifaces = os.networkInterfaces();
var interfaces = os.networkInterfaces();
var localhost = 'http://127.0.0.1';
for (var k in interfaces) {
	var addresses = [];
	for (var k2 in interfaces[k]) {
		var address = interfaces[k][k2];
		if (address.family === 'IPv4' && !address.internal) {
			addresses.push(address.address);
		}
	}
	localhost = addresses[0];
}
var port = process.env.PORT || 4040;
console.log('Start Nodejs Server: ' + localhost + ':' + port);

//////////////////////////////////////////////////////////
///                        Control server ip                         ///
//////////////////////////////////////////////////////////
var controlIP = 'http://140.115.156.47:3000';
var nodejsIP = 'http://' + localhost + ':' + port;
var janusIP = 'http://' + localhost + ':' + '4000' + '/janus';
var serverName = 'Server01';
console.log('Nodejs IP: ' + nodejsIP);
console.log('Janus IP: ' + janusIP + '(' + serverName + ')');

//////////////////////////////////////////////////////////
///                  http server for user                          ///
//////////////////////////////////////////////////////////
var express = require('express'); 
var app = express();
var http = require('http').Server(app);
var server = app.listen(port);
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // Body parser use JSON data
app.use(bodyParser.urlencoded({ extended: false })); 

app.get('/Rtt', function(request, response) {
	response.setHeader("Access-Control-Allow-Origin","*"); 
	response.end();
});

//////////////////////////////////////////////////////////
///                 web socket server for edge             ///
//////////////////////////////////////////////////////////
var ioc = require('socket.io-client');
var socket = ioc.connect(controlIP, {reconnect: true});
var sendStatsInterval = null; 
socket.on('connect', function() {  
	console.log('Connect to Control Server(' + controlIP + ')');
	sendMessage({
		'type' : 'edgeServerConnected',
		'janusIP' : janusIP,
		'nodejsIP' : nodejsIP
	});
	sendStatsInterval = setInterval(gatherStats, 1000); 
});
socket.on('message', function(msg){
	console.log('Message In: ' + msg['type']);
	switch(msg['type']){
		case 'edgeToEdgeRttCollect':
			gatherRttToOtherEdge(msg['nodejsList']);
		break;
		default:
		break;
	}
});
socket.on('disconnect', function () {
	console.log('Disconnected to Control Server(' + controlIP + ')');
	clearInterval(sendStatsInterval);
});
function sendMessage (json) {
	socket.emit('message', json);
}


//////////////////////////////////////////////////////////
///                 monitor edge resource                     ///
//////////////////////////////////////////////////////////
var fs = require('fs');
function gatherStats () {
	getCPUStats(function (cpu) {
		getNetworkStats( function (network_in, network_out) {
			if((network_in != -1) && (network_out != -1)) {
				network = network_out;
				sendMessage({
					'type' : 'edgeServerStateRes',
					'cpuState' : cpu,
					'networkState' : network
				});
			}
		});
	});
}

function getCPUStats (callback) {
	var startMeasure = cpuAverage();		//Grab first CPU Measure
	setTimeout(function() {  //Set delay for second Measure
		//Grab second Measure
		var endMeasure = cpuAverage(); 
		//Calculate the difference in idle and total time between the measures
		var idleDifference = endMeasure.idle - startMeasure.idle;
		var totalDifference = endMeasure.total - startMeasure.total;
		//Calculate the average percentage CPU usage
		var percentageCPU = 100 - ~~(100 * idleDifference / totalDifference); 
		//Output result to console
		return callback(percentageCPU);
	}, 100);
}
function cpuAverage() { 
	var totalIdle = 0, totalTick = 0; //Initialise sum of idle and time of cores and fetch CPU info
	var cpus = os.cpus();
	for(var i = 0, len = cpus.length; i < len; i++) { //Loop through CPU cores
		var cpu = cpus[i]; //Select CPU core
		for(var type in cpu.times) { //Total up the time in the cores tick
			totalTick += cpu.times[type];
		}
		totalIdle += cpu.times.idle; //Total up the idle time of the core
	}
	return {idle: totalIdle / cpus.length,  total: totalTick / cpus.length}; //Return the average Idle and Tick times
}
function getNetworkStats (callback) {
	fs.readFile('/tmp/monitor_txrx_bw_r', 'utf-8', function (err, data) {
		if (err) throw err;
		console.log(data);
		var array = data.split(':');
		var network_in = [], network_out = [];
		if(array.length == 2){
			network_in = array[0].split(' ');
			network_out = array[1].split(' ');
		}
		if((network_in.length == 2) && (network_out.length == 2)) {
			return callback(network_in[1], network_out[1]);
		} else {
			return callback(-1, -1);
		}
	});
}

//////////////////////////////////////////////////////////
///                 monitor edge resource                     ///
//////////////////////////////////////////////////////////
var request = require("request");
function gatherRttToOtherEdge (nodejsList) {
	console.log("gatherRttToOtherEdge");
	if(nodejsList != null) {
		var rttResult = {};
		var finish = nodejsList.length;
		for (var i in nodejsList) {
			sendRttRequest(i, nodejsList[i], function (index, rtt) {
				rttResult[nodejsList[index]] = rtt;
				finish--;
				if(finish == 0){
					sendMessage({
						'type' : 'edgeToEdgeRttCollectRes',
						'rttResult' : rttResult//JSON.stringify(rttResult)
					});
				}
			});
		}
	} else {
		console.log("no available edge server");
	}
}

function sendRttRequest (i, url, callback1) {
	console.log("sendRttRequest");
	if (url == nodejsIP) {
		return callback1(i, 0);
	}

	var start_time = new Date().getTime();
	var options = {
		method: 'GET',
		uri: url + '/Rtt',
		headers: {"content-type": "application/json", "Cache-Control": "no-cache"}
	};
	var callback2 = function (error, response, body) {
		if (error) {
			console.log("Failed: " + error);
			return callback1(i, 10000);
		} else {
			var request_time = new Date().getTime() - start_time;
			return callback1(i, request_time);
		}
	};
	request(options, callback2);
}