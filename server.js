const request = require('request');
const admin = require('firebase-admin');
const geofire = require('geofire');
const NodeGeocoder = require('node-geocoder');

const API_TOKEN = '';
const MAX_RADIUS_KM = 1;

admin.initializeApp({
	credential: admin.credential.cert(''),
	databaseURL: ''
});
const ref = admin.database().ref();
const geoFire = new geofire(admin.database().ref('geofire'));
const userRef = admin.database().ref('users');

const options = {
	provider: 'google',
	httpAdapter: 'https'
}
const geocoder = NodeGeocoder(options);

function listenForNotificationRequests() {
	const requests = ref.child('notificationRequests');
	requests.on('child_added', requestSnapshot => {
		const request = requestSnapshot.val(),
			lat = parseFloat(request.latitude),
			lon = parseFloat(request.longitude);

		geocoder.reverse({ lat: lat, lon: lon })
			.then(res => {
				const address = res[0].formattedAddress,
					lastIndex = address.lastIndexOf(',');
				return address.substring(0, lastIndex);
			})
			.then(address => {
				const geoQuery = geoFire.query({
					center: [lat, lon],
					radius: MAX_RADIUS_KM
				});
				const keys = [];

				geoQuery.on('ready', () => {
					console.log('GeoQuery has loaded and fired all other events for initial data');
					geoQuery.cancel();

					if (keys.length === 0) {
						requests.child(requestSnapshot.getKey()).remove(); 
						return;
					}

					userRef.child(request.senderID).once('value')
						.then(snapshot => {
							const firstName = snapshot.child('firstName').val(),
								lastName = snapshot.child('lastName').val();

							sendNotificationToUsers(keys, {
								address: address,
								lat: lat,
								lon: lon,
								time: request.time,
								message: request.message,
								senderName: firstName + ' ' + lastName
							}, () => requests.child(requestSnapshot.getKey()).remove()); 
						});
				});
				
				geoQuery.on('key_entered', (key, location, distance) => {
					if (key === request.senderID) return;

					keys.push(key);
					console.log(key + ' entered query at ' + location + ' (' + distance + ' km from center)');
				});
			});
	}, error => console.error(error));
}

function sendNotificationToUsers(keys, data, onSuccess) {
	getUserTokens(keys)
		.then(tokens => {
			if (tokens.length === 0) return;

			request({
				url: 'https://fcm.googleapis.com/fcm/send',
				method: 'POST',
				headers: {
					'Content-Type' :' application/json',
					'Authorization': 'key='+API_TOKEN
				},
				body: JSON.stringify({
					registration_ids: tokens,
					priority: 'high',
					data: data
				})
			}, (error, response, body) => {
				if (error) {
					console.error(error);
				} else if (response.statusCode >= 400) { 
					console.error('HTTP Error: '+response.statusCode+' - '+response.statusMessage); 
				} else {
					onSuccess();
				}
			});
		});
}

function getUserTokens(userIDs) {
	const promises = [];
	userIDs.forEach(userID => {
		promises.push(
				userRef.child(userID).once('value'));
	});
	return Promise.all(promises)
			.then(userPromises => {
				return userPromises.map(dataSnapshot => {
					return dataSnapshot.child('token').val();
				});
			});
}

// start listening
listenForNotificationRequests();
