import { Table, Select, message } from "antd";
import axios from "axios";
import { useEffect, useState } from "react";

const { Option } = Select;
const url = process.env.REACT_APP_URL;

const UserTable = () => {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const token = localStorage.getItem("access_token");

    const res = await axios.get(`${url}/api/users/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    setUsers(res.data);
  };

  const handleRoleChange = async (userId, newRole) => {
    const token = localStorage.getItem("access_token");

    await axios.put(`${url}/api/users/${userId}/role`, 
      { role: newRole },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    message.success("Rol actualizado");
    fetchUsers(); // Refresca tabla
  };

  const columns = [
    { title: "Email", dataIndex: "email" },
    { 
      title: "Rol",
      dataIndex: "role",
      render: (role, record) => (
        <Select value={role} onChange={(value) => handleRoleChange(record.id, value)}>
          <Option value={0}>Empleado</Option>
          <Option value={1}>Supervisor</Option>
          <Option value={2}>Dueño de Campo</Option>
          <Option value={3}>Admin</Option>
        </Select>
      ),
    },
  ];

  return <Table scroll={{ x: "max-content" }} dataSource={users} columns={columns} rowKey="id" pagination={{ position: ['bottomCenter'] }}/>;
};

export default UserTable;
