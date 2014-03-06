$(document).foundation();
var socket = io.connect('http://dev.oglabs.info:1337');
socket.on('update', function (data) {
	console.log(data);
	$('.updates').prepend(data.content);
});
$('.turnOff').on('click', function (event){
	event.preventDefault();
	$.get('/notifications/read', function(data){

	});
});