// Test script para verificar el endpoint de notificaciones
// Ejecutar en la consola del navegador (F12)

// 1. Verificar que tenemos token
const token = localStorage.getItem('access_token');
console.log('Token:', token ? 'Existe ✅' : 'No existe ❌');

// 2. Verificar user_id
const user = JSON.parse(localStorage.getItem('user') || '{}');
console.log('User ID:', user.id);

// 3. Probar endpoint de contador
fetch('http://localhost:4000/api/notifications/unread-count', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
})
    .then(res => res.json())
    .then(data => console.log('Unread Count Response:', data))
    .catch(err => console.error('Error:', err));

// 4. Probar endpoint de lista
fetch('http://localhost:4000/api/notifications', {
    headers: {
        'Authorization': `Bearer ${token}`
    }
})
    .then(res => res.json())
    .then(data => console.log('Notifications List Response:', data))
    .catch(err => console.error('Error:', err));
