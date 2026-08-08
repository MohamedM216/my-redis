## introduction
my own redis in javascript...

## run
there's more than one option to run commands against the my-redis server
```
redis-cli -h 127.0.0.1 -p 6380 ping
```
```
nc 127.0.0.1 6380
```
```
printf "PING\r\n" | nc -w 1 127.0.0.1 6380
```
```
telnet 127.0.0.1 6380
```
server can handle multiple PINGs & multiple users
```
printf "PING\r\nPING\r\n" | nc -w 1 127.0.0.1 6380
```